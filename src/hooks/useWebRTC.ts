"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { isMicLive, useAppStore } from "@/stores/app-store";
import { QUALITY_PRESETS, type VideoQuality } from "@/lib/types";
import {
  MIC_CONSTRAINTS,
  createMicPipeline,
  describeMediaError,
  type MicPipeline,
} from "@/lib/media";

/**
 * Full-mesh P2P WebRTC with a Web Audio engine for send + receive.
 *
 * Send: raw mic → GainNode (mic level) → MediaStreamDestination → peers.
 * The AudioContext is explicitly RESUMED and awaited before the outgoing
 * track is trusted (a suspended context emits silence — the v0.2.2 mute
 * regression). Receive: each peer → per-peer GainNode → master GainNode →
 * one <audio> sink (output-device routable). Per-user/master volume and
 * deafen are all local gain changes.
 */
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ],
};

const log = (...a: unknown[]) => console.log("[aocom-voice]", ...a);

type Signal =
  | { kind: "sdp"; description: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

interface RemoteAudio {
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
}

interface Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  stream: MediaStream | null;
  screenStream: MediaStream | null;
  camTransceiver: RTCRtpTransceiver | null;
  screenTransceiver: RTCRtpTransceiver | null;
  pendingCandidates: RTCIceCandidateInit[];
  audio: RemoteAudio | null;
}

export function useWebRTC(userId: string | null) {
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const sigRef = useRef<RealtimeChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const rawMicRef = useRef<MediaStream | null>(null);
  const micPipeRef = useRef<MicPipeline | null>(null);
  const camTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<Map<string, AnalyserNode>>(new Map());
  const speakTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Receive engine.
  const masterGainRef = useRef<GainNode | null>(null);
  const outputElRef = useRef<HTMLAudioElement | null>(null);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);
  const [remoteScreens, setRemoteScreens] = useState<Record<string, MediaStream>>({});
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);

  const bumpRemote = useCallback((peerId: string, stream: MediaStream | null) => {
    setRemoteStreams((prev) => {
      const next = { ...prev };
      if (stream) next[peerId] = stream;
      else delete next[peerId];
      return next;
    });
  }, []);
  const bumpLocal = useCallback(() => {
    const local = localStreamRef.current;
    setLocalStream(local ? new MediaStream(local.getTracks()) : null);
  }, []);
  const bumpScreen = useCallback((peerId: string, stream: MediaStream | null) => {
    setRemoteScreens((prev) => {
      const next = { ...prev };
      if (stream) next[peerId] = stream;
      else delete next[peerId];
      return next;
    });
  }, []);

  const sendSignal = useCallback(
    (to: string, signal: Signal) => {
      sigRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { from: userId, to, ...signal },
      });
    },
    [userId]
  );

  /* ── Audio engine ─────────────────────────────────────────────────── */
  const ensureCtx = useCallback(async (): Promise<AudioContext> => {
    if (!audioCtxRef.current)
      audioCtxRef.current = new AudioContext({ latencyHint: "interactive" });
    const ctx = audioCtxRef.current;
    if (ctx.state !== "running") {
      await ctx.resume().catch(() => {});
      log("AudioContext state after resume:", ctx.state);
    }
    return ctx;
  }, []);

  const ensureOutput = useCallback(async (): Promise<GainNode> => {
    const ctx = await ensureCtx();
    if (masterGainRef.current) return masterGainRef.current;
    const master = ctx.createGain();
    const st = useAppStore.getState();
    master.gain.value = st.deafened ? 0 : st.masterVolume;
    const dest = ctx.createMediaStreamDestination();
    master.connect(dest);
    const el = document.createElement("audio");
    el.autoplay = true;
    el.srcObject = dest.stream;
    (el as HTMLAudioElement).style.display = "none";
    document.body.appendChild(el);
    void el.play().catch((e) => log("output <audio> play() blocked:", e));
    const sink = st.speakerDeviceId;
    if (sink) {
      const s = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      await s.setSinkId?.(sink).catch(() => {});
    }
    masterGainRef.current = master;
    outputElRef.current = el;
    return master;
  }, [ensureCtx]);

  const addRemoteAudio = useCallback(
    async (peerId: string, track: MediaStreamTrack) => {
      const ctx = await ensureCtx();
      const master = await ensureOutput();
      const peer = peersRef.current.get(peerId);
      if (!peer) return;
      // Tear down any previous audio graph for this peer.
      peer.audio?.source.disconnect();
      peer.audio?.gain.disconnect();
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      const gain = ctx.createGain();
      gain.gain.value = useAppStore.getState().peerVolumes[peerId] ?? 1;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(gain);
      gain.connect(master);
      gain.connect(analyser);
      peer.audio = { source, gain, analyser };
      analysersRef.current.set(peerId, analyser);
      log(peerId, "remote audio wired; track", track.readyState, "muted", track.muted);
    },
    [ensureCtx, ensureOutput]
  );

  const closePeer = useCallback(
    (peerId: string) => {
      const peer = peersRef.current.get(peerId);
      if (!peer) return;
      peer.pc.onnegotiationneeded = null;
      peer.pc.onicecandidate = null;
      peer.pc.ontrack = null;
      peer.pc.close();
      peer.audio?.source.disconnect();
      peer.audio?.gain.disconnect();
      peersRef.current.delete(peerId);
      analysersRef.current.delete(peerId);
      bumpRemote(peerId, null);
      bumpScreen(peerId, null);
      log(peerId, "peer closed");
    },
    [bumpRemote, bumpScreen]
  );

  const createPeer = useCallback(
    (peerId: string) => {
      if (!userId || peersRef.current.has(peerId)) return;

      const pc = new RTCPeerConnection(RTC_CONFIG);
      const peer: Peer = {
        pc,
        polite: userId > peerId, // deterministic from sorted UIDs
        makingOffer: false,
        ignoreOffer: false,
        stream: null,
        screenStream: null,
        camTransceiver: null,
        screenTransceiver: null,
        pendingCandidates: [],
        audio: null,
      };
      peersRef.current.set(peerId, peer);
      log(peerId, "createPeer polite=", peer.polite);

      // Bind the outgoing audio track BEFORE any offer/answer.
      const local = localStreamRef.current;
      const audioTrack = local?.getAudioTracks()[0];
      if (audioTrack) {
        const sender = pc.addTrack(audioTrack, local!);
        const params = sender.getParameters();
        if (params.encodings.length) {
          params.encodings[0].priority = "high";
          params.encodings[0].networkPriority = "high";
          void sender.setParameters(params).catch(() => {});
        }
        log(peerId, "added local audio track", audioTrack.readyState);
      } else {
        log(peerId, "WARNING: no local audio track at createPeer");
      }

      const camTransceiver = pc.addTransceiver("video", { direction: "sendrecv" });
      const screenTransceiver = pc.addTransceiver("video", { direction: "sendrecv" });
      peer.camTransceiver = camTransceiver;
      peer.screenTransceiver = screenTransceiver;
      if (camTrackRef.current)
        void camTransceiver.sender.replaceTrack(camTrackRef.current);
      if (screenTrackRef.current)
        void screenTransceiver.sender.replaceTrack(screenTrackRef.current);

      pc.onnegotiationneeded = async () => {
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription)
            sendSignal(peerId, { kind: "sdp", description: pc.localDescription });
        } catch (err) {
          console.error("[aocom-voice] negotiation failed", peerId, err);
        } finally {
          peer.makingOffer = false;
        }
      };

      pc.onicecandidate = (e) => {
        if (e.candidate)
          sendSignal(peerId, { kind: "ice", candidate: e.candidate.toJSON() });
      };

      pc.oniceconnectionstatechange = () =>
        log(peerId, "ice=", pc.iceConnectionState);
      pc.onsignalingstatechange = () => log(peerId, "sig=", pc.signalingState);
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        log(peerId, "pc=", st);
        if (st === "failed") {
          log(peerId, "connection failed → restartIce");
          pc.restartIce();
        } else if (st === "disconnected") {
          // Give ICE a moment to self-heal; renegotiate if it doesn't.
          setTimeout(() => {
            if (pc.connectionState === "disconnected") {
              log(peerId, "still disconnected → restartIce");
              pc.restartIce();
            }
          }, 2500);
        }
      };

      pc.ontrack = (e) => {
        if (e.track.kind === "video" && e.transceiver === peer.screenTransceiver) {
          const scr = new MediaStream([e.track]);
          peer.screenStream = scr;
          const sync = () =>
            bumpScreen(peerId, e.track.muted || e.track.readyState === "ended" ? null : scr);
          e.track.onmute = sync;
          e.track.onunmute = sync;
          e.track.onended = () => bumpScreen(peerId, null);
          sync();
          return;
        }

        if (!peer.stream) peer.stream = new MediaStream();
        if (!peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track);
        const stream = peer.stream;

        if (e.track.kind === "audio") {
          // Route remote audio through the Web Audio engine (per-peer gain).
          void addRemoteAudio(peerId, e.track);
          e.track.onended = () => log(peerId, "remote audio track ended");
        } else {
          // camera video
          e.track.onmute = () => bumpRemote(peerId, stream);
          e.track.onunmute = () => bumpRemote(peerId, stream);
        }
        bumpRemote(peerId, stream);
      };

      return peer;
    },
    [userId, sendSignal, bumpRemote, bumpScreen, addRemoteAudio]
  );

  const handleSignal = useCallback(
    async (payload: { from: string; to: string } & Signal) => {
      if (!userId || payload.to !== userId) return;
      const peerId = payload.from;
      let peer = peersRef.current.get(peerId);
      if (!peer) peer = createPeer(peerId);
      if (!peer) return;
      const { pc } = peer;

      try {
        if (payload.kind === "sdp") {
          const desc = payload.description;
          const offerCollision =
            desc.type === "offer" &&
            (peer.makingOffer || pc.signalingState !== "stable");
          peer.ignoreOffer = !peer.polite && offerCollision;
          if (peer.ignoreOffer) {
            log(peerId, "ignoring colliding offer (impolite)");
            return;
          }
          await pc.setRemoteDescription(desc);
          for (const cand of peer.pendingCandidates.splice(0)) {
            await pc.addIceCandidate(cand).catch(() => {});
          }
          if (desc.type === "offer") {
            await pc.setLocalDescription();
            if (pc.localDescription)
              sendSignal(peerId, { kind: "sdp", description: pc.localDescription });
          }
        } else if (payload.kind === "ice") {
          if (!pc.remoteDescription || !pc.remoteDescription.type) {
            peer.pendingCandidates.push(payload.candidate);
          } else {
            try {
              await pc.addIceCandidate(payload.candidate);
            } catch (err) {
              if (!peer.ignoreOffer) throw err;
            }
          }
        }
      } catch (err) {
        console.error("[aocom-voice] signal handling failed", peerId, err);
      }
    },
    [userId, createPeer, sendSignal]
  );

  /* ── Join / leave ─────────────────────────────────────────────────── */
  const buildMicPipeline = useCallback(
    async (deviceId: string | null): Promise<MediaStreamTrack | null> => {
      const raw = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...MIC_CONSTRAINTS,
          ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
        },
      });
      const ctx = await ensureCtx(); // resumed + verified running
      const pipe = createMicPipeline(ctx, raw, useAppStore.getState().micLevel);
      rawMicRef.current = raw;
      micPipeRef.current = pipe;
      const track = pipe.stream.getAudioTracks()[0];
      track.contentHint = "speech";
      analysersRef.current.set(userId!, pipe.analyser);
      log("mic pipeline ready; ctx=", ctx.state, "track=", track.readyState);
      // Recover if the hardware device drops (unplug / device change).
      raw.getAudioTracks()[0].onended = () => {
        log("raw mic ended → recapturing");
        void setMicDevice(useAppStore.getState().micDeviceId);
      };
      return track;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [ensureCtx, userId]
  );

  const join = useCallback(
    async (channelId: string): Promise<boolean> => {
      if (!userId) return false;
      let micTrack: MediaStreamTrack | null;
      try {
        micTrack = await buildMicPipeline(useAppStore.getState().micDeviceId);
      } catch (err) {
        useAppStore.getState().setMicError(describeMediaError(err));
        log("getUserMedia failed", err);
        return false;
      }
      if (!micTrack) return false;
      useAppStore.getState().setMicError(null);

      const mic = new MediaStream([micTrack]);
      mic.getAudioTracks().forEach((t) => (t.enabled = isMicLive(useAppStore.getState())));
      localStreamRef.current = mic;
      setLocalStream(mic);
      await ensureOutput(); // prime the receive graph before peers connect

      const sig = supabase.channel(`voice:${channelId}`, {
        config: { private: true, presence: { key: userId }, broadcast: { self: false } },
      });
      sigRef.current = sig;
      sig
        .on("broadcast", { event: "signal" }, ({ payload }) => handleSignal(payload))
        .on("presence", { event: "sync" }, () => {
          const ids = Object.keys(sig.presenceState()).filter((k) => k !== userId);
          for (const id of ids) createPeer(id);
          for (const known of peersRef.current.keys())
            if (!ids.includes(known)) closePeer(known);
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            await sig.track({ joined_at: new Date().toISOString() });
            setConnected(true);
            await supabase.from("active_status").upsert({
              user_id: userId,
              is_online: true,
              current_voice_channel: channelId,
              updated_at: new Date().toISOString(),
            });
          }
        });

      // Speaking detection: 50ms poll, EMA smoothing, 500ms hangover. Once
      // energy crosses the floor, the glow stays true for ≥500ms.
      const buf = new Uint8Array(1024);
      const ema = new Map<string, number>();
      const lastActive = new Map<string, number>();
      const THRESHOLD = 6;
      const HANG_MS = 500;
      speakTimerRef.current = setInterval(() => {
        const t = Date.now();
        for (const [id, analyser] of analysersRef.current) {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += (v - 128) * (v - 128);
          const rms = Math.sqrt(sum / buf.length);
          const smoothed = (ema.get(id) ?? 0) * 0.7 + rms * 0.3;
          ema.set(id, smoothed);
          if (smoothed > THRESHOLD) lastActive.set(id, t);
        }
        const now = new Set<string>();
        for (const [id, ts] of lastActive)
          if (t - ts < HANG_MS && analysersRef.current.has(id)) now.add(id);
        setSpeakingIds((prev) =>
          prev.size === now.size && [...prev].every((x) => now.has(x)) ? prev : now
        );
      }, 50);

      return true;
    },
    [userId, buildMicPipeline, ensureOutput, handleSignal, createPeer, closePeer]
  );

  const leave = useCallback(async () => {
    if (speakTimerRef.current) clearInterval(speakTimerRef.current);
    speakTimerRef.current = null;
    for (const id of [...peersRef.current.keys()]) closePeer(id);

    camTrackRef.current?.stop();
    camTrackRef.current = null;
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    micPipeRef.current?.disconnect();
    micPipeRef.current = null;
    rawMicRef.current?.getTracks().forEach((t) => t.stop());
    rawMicRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    masterGainRef.current?.disconnect();
    masterGainRef.current = null;
    if (outputElRef.current) {
      outputElRef.current.srcObject = null;
      outputElRef.current.remove();
      outputElRef.current = null;
    }
    analysersRef.current.clear();
    setLocalStream(null);
    setRemoteStreams({});
    setLocalScreen(null);
    setRemoteScreens({});
    setSpeakingIds(new Set());
    setConnected(false);

    if (sigRef.current) {
      await supabase.removeChannel(sigRef.current);
      sigRef.current = null;
    }
    if (userId) {
      await supabase.from("active_status").upsert({
        user_id: userId,
        is_online: true,
        current_voice_channel: null,
        updated_at: new Date().toISOString(),
      });
    }
  }, [userId, closePeer]);

  /* ── Camera / screen (unchanged behavior) ─────────────────────────── */
  const setCamera = useCallback(
    async (on: boolean, quality: VideoQuality) => {
      const local = localStreamRef.current;
      if (!local) return;
      if (on && !camTrackRef.current) {
        const preset = QUALITY_PRESETS[quality];
        let cam: MediaStream;
        try {
          cam = await navigator.mediaDevices.getUserMedia({
            video: { ...preset, facingMode: "user" },
          });
        } catch (err) {
          useAppStore.getState().setMicError(describeMediaError(err));
          useAppStore.getState().setCamOn(false);
          return;
        }
        const track = cam.getVideoTracks()[0];
        track.contentHint = "motion";
        camTrackRef.current = track;
        local.addTrack(track);
        track.onended = () => useAppStore.getState().setCamOn(false);
        bumpLocal();
        await Promise.all(
          [...peersRef.current.values()].map(
            (p) => p.camTransceiver?.sender.replaceTrack(track) ?? Promise.resolve()
          )
        );
      } else if (!on && camTrackRef.current) {
        const track = camTrackRef.current;
        camTrackRef.current = null;
        local.removeTrack(track);
        track.stop();
        bumpLocal();
        await Promise.all(
          [...peersRef.current.values()].map(
            (p) => p.camTransceiver?.sender.replaceTrack(null) ?? Promise.resolve()
          )
        );
      }
    },
    [bumpLocal]
  );

  const stopScreenShare = useCallback(async () => {
    const track = screenTrackRef.current;
    if (!track) return;
    screenTrackRef.current = null;
    await Promise.all(
      [...peersRef.current.values()].map(
        (p) => p.screenTransceiver?.sender.replaceTrack(null) ?? Promise.resolve()
      )
    );
    track.stop();
    setLocalScreen(null);
  }, []);

  const startScreenShare = useCallback(async () => {
    if (screenTrackRef.current) return;
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch {
      return;
    }
    const track = display.getVideoTracks()[0];
    if (!track) return;
    track.contentHint = "detail";
    display.getAudioTracks().forEach((t) => t.stop());
    screenTrackRef.current = track;
    track.onended = () => void stopScreenShare();
    setLocalScreen(new MediaStream([track]));
    await Promise.all(
      [...peersRef.current.values()].map(
        (p) => p.screenTransceiver?.sender.replaceTrack(track) ?? Promise.resolve()
      )
    );
  }, [stopScreenShare]);

  const applyQuality = useCallback(async (quality: VideoQuality) => {
    const track = camTrackRef.current;
    if (!track) return;
    const preset = QUALITY_PRESETS[quality];
    try {
      await track.applyConstraints({
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: preset.frameRate },
      });
    } catch {}
  }, []);

  const setMicDevice = useCallback(
    async (deviceId: string | null) => {
      const local = localStreamRef.current;
      if (!local || !userId) return;
      try {
        const freshRaw = await navigator.mediaDevices.getUserMedia({
          audio: { ...MIC_CONSTRAINTS, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
        });
        const ctx = await ensureCtx();
        const pipe = createMicPipeline(ctx, freshRaw, useAppStore.getState().micLevel);
        const newTrack = pipe.stream.getAudioTracks()[0];
        newTrack.contentHint = "speech";
        newTrack.enabled = isMicLive(useAppStore.getState());
        await Promise.all(
          [...peersRef.current.values()].map((p) => {
            const sender = p.pc.getSenders().find((s) => s.track?.kind === "audio");
            return sender ? sender.replaceTrack(newTrack) : Promise.resolve();
          })
        );
        const oldTrack = local.getAudioTracks()[0];
        if (oldTrack) {
          local.removeTrack(oldTrack);
          oldTrack.stop();
        }
        local.addTrack(newTrack);
        micPipeRef.current?.disconnect();
        rawMicRef.current?.getTracks().forEach((t) => t.stop());
        micPipeRef.current = pipe;
        rawMicRef.current = freshRaw;
        analysersRef.current.set(userId, pipe.analyser);
        freshRaw.getAudioTracks()[0].onended = () =>
          void setMicDevice(useAppStore.getState().micDeviceId);
        bumpLocal();
      } catch (err) {
        useAppStore.getState().setMicError(describeMediaError(err));
      }
    },
    [userId, ensureCtx, bumpLocal]
  );

  const setMicEnabled = useCallback((enabled: boolean) => {
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }, []);

  /* ── Volume controls (all local) ──────────────────────────────────── */
  const applyMicLevel = useCallback((v: number) => {
    if (micPipeRef.current) micPipeRef.current.gain.gain.value = v;
  }, []);
  const applyMasterVolume = useCallback((v: number) => {
    if (masterGainRef.current) masterGainRef.current.gain.value = v;
  }, []);
  const setPeerVolume = useCallback((peerId: string, v: number) => {
    const g = peersRef.current.get(peerId)?.audio?.gain;
    if (g) g.gain.value = v;
  }, []);
  const applyOutputSink = useCallback(async (deviceId: string | null) => {
    const el = outputElRef.current as
      | (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> })
      | null;
    if (el && deviceId) await el.setSinkId?.(deviceId).catch(() => {});
  }, []);

  useEffect(() => () => void leave(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    join,
    leave,
    setCamera,
    applyQuality,
    setMicDevice,
    setMicEnabled,
    startScreenShare,
    stopScreenShare,
    applyMicLevel,
    applyMasterVolume,
    setPeerVolume,
    applyOutputSink,
    localStream,
    remoteStreams,
    localScreen,
    remoteScreens,
    speakingIds,
    connected,
  };
}
