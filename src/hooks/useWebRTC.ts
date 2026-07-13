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
 * Full-mesh P2P WebRTC.
 *
 * Media m-lines use addTrack (never bare addTransceiver) so both peers'
 * SDP stays symmetric — camera and screen tracks each ride a dedicated,
 * stable MediaStream whose id (msid) survives to the receiver. A tiny
 * "roles" broadcast tells peers which stream id is camera vs screen, so a
 * screen share appears as its OWN tile without ever replacing the camera.
 *
 * Audio: mic → GainNode → MediaStreamDestination → peers. AudioContext is
 * locked to 48 kHz and awaited-resumed (fixes silence + helium pitch drift).
 * Receive: per-peer GainNode → master → one <audio> sink.
 */
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ],
};
const SAMPLE_RATE = 48000;
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
  stream: MediaStream | null; // camera composite (for the peer tile)
  screenStream: MediaStream | null;
  pendingCandidates: RTCIceCandidateInit[];
  audio: RemoteAudio | null;
  audioPump: HTMLAudioElement | null;
  /** Received video tracks + the stream id they arrived on. */
  videoTracks: { track: MediaStreamTrack; streamId: string | null }[];
  /** This peer's advertised stream roles. */
  roles: { camId: string | null; screenId: string | null };
}

export function useWebRTC(userId: string | null) {
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const sigRef = useRef<RealtimeChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const rawMicRef = useRef<MediaStream | null>(null);
  const micPipeRef = useRef<MicPipeline | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const camTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<Map<string, AnalyserNode>>(new Map());
  const speakTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const outputElRef = useRef<HTMLAudioElement | null>(null);
  // Late-bound so the roles handler (defined before stopScreenShare) can
  // still trigger single-active enforcement.
  const stopScreenShareRef = useRef<() => void>(() => {});

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);
  const [remoteScreens, setRemoteScreens] = useState<Record<string, MediaStream>>({});
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  const [maximizedScreen, setMaximizedScreen] = useState<string | null>(null);
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

  const sendRoles = useCallback(() => {
    sigRef.current?.send({
      type: "broadcast",
      event: "roles",
      payload: {
        from: userId,
        camId: camStreamRef.current?.id ?? null,
        screenId: screenTrackRef.current ? screenStreamRef.current?.id ?? null : null,
      },
    });
  }, [userId]);

  /* ── Video classification ─────────────────────────────────────────── */
  const reclassify = useCallback(
    (peerId: string) => {
      const peer = peersRef.current.get(peerId);
      if (!peer) return;
      const cam: MediaStreamTrack[] = [];
      const scr: MediaStreamTrack[] = [];
      for (const vt of peer.videoTracks) {
        if (vt.track.readyState === "ended") continue;
        const isScr = !!peer.roles.screenId && vt.streamId === peer.roles.screenId;
        (isScr ? scr : cam).push(vt.track);
      }
      peer.stream = new MediaStream(cam);
      bumpRemote(peerId, peer.stream); // tile always present; shows avatar if no live video
      const liveScr = scr.some((t) => t.readyState === "live" && !t.muted);
      peer.screenStream = liveScr ? new MediaStream(scr) : null;
      bumpScreen(peerId, peer.screenStream);
    },
    [bumpRemote, bumpScreen]
  );

  /* ── Audio engine ─────────────────────────────────────────────────── */
  const ensureCtx = useCallback(async (): Promise<AudioContext> => {
    if (!audioCtxRef.current) {
      try {
        // Lock 48 kHz so mic capture and the graph agree instantly — no
        // resample "helium" pitch drift on join.
        audioCtxRef.current = new AudioContext({
          sampleRate: SAMPLE_RATE,
          latencyHint: "interactive",
        });
      } catch {
        audioCtxRef.current = new AudioContext({ latencyHint: "interactive" });
      }
    }
    const ctx = audioCtxRef.current;
    if (ctx.state !== "running") {
      await ctx.resume().catch(() => {});
      log("AudioContext state after resume:", ctx.state, "rate", ctx.sampleRate);
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
    el.style.display = "none";
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
      peer.audio?.source.disconnect();
      peer.audio?.gain.disconnect();
      peer.audioPump?.remove();
      const audioStream = new MediaStream([track]);
      const pump = document.createElement("audio"); // muted pump keeps samples flowing
      pump.autoplay = true;
      pump.muted = true;
      pump.srcObject = audioStream;
      pump.style.display = "none";
      document.body.appendChild(pump);
      void pump.play().catch(() => {});
      peer.audioPump = pump;
      const source = ctx.createMediaStreamSource(audioStream);
      const gain = ctx.createGain();
      gain.gain.value = useAppStore.getState().peerVolumes[peerId] ?? 1;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(gain);
      gain.connect(master);
      gain.connect(analyser);
      peer.audio = { source, gain, analyser };
      analysersRef.current.set(peerId, analyser);
      log(peerId, "remote audio wired; muted", track.muted);
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
      peer.audioPump?.remove();
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
        polite: userId > peerId,
        makingOffer: false,
        ignoreOffer: false,
        stream: null,
        screenStream: null,
        pendingCandidates: [],
        audio: null,
        audioPump: null,
        videoTracks: [],
        roles: { camId: null, screenId: null },
      };
      peersRef.current.set(peerId, peer);
      log(peerId, "createPeer polite=", peer.polite);

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
      } else {
        log(peerId, "WARNING: no local audio track at createPeer");
      }
      // Attach current camera / screen (each on its dedicated stream).
      if (camTrackRef.current && camStreamRef.current)
        pc.addTrack(camTrackRef.current, camStreamRef.current);
      if (screenTrackRef.current && screenStreamRef.current)
        pc.addTrack(screenTrackRef.current, screenStreamRef.current);

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
      pc.oniceconnectionstatechange = () => log(peerId, "ice=", pc.iceConnectionState);
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        log(peerId, "pc=", st);
        if (st === "failed") pc.restartIce();
        else if (st === "disconnected")
          setTimeout(() => {
            if (pc.connectionState === "disconnected") pc.restartIce();
          }, 2500);
      };

      pc.ontrack = (e) => {
        if (e.track.kind === "audio") {
          void addRemoteAudio(peerId, e.track);
          reclassify(peerId); // ensure the tile exists even without video
          return;
        }
        // Video: record it, classify by advertised roles, reclassify on change.
        const streamId = e.streams[0]?.id ?? null;
        peer.videoTracks.push({ track: e.track, streamId });
        log(peerId, "video track streamId", streamId, "roles", peer.roles);
        e.track.onmute = () => reclassify(peerId);
        e.track.onunmute = () => reclassify(peerId);
        e.track.onended = () => reclassify(peerId);
        reclassify(peerId);
      };

      return peer;
    },
    [userId, sendSignal, addRemoteAudio, reclassify]
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
          if (peer.ignoreOffer) return;
          await pc.setRemoteDescription(desc);
          for (const cand of peer.pendingCandidates.splice(0))
            await pc.addIceCandidate(cand).catch(() => {});
          if (desc.type === "offer") {
            await pc.setLocalDescription();
            if (pc.localDescription)
              sendSignal(peerId, { kind: "sdp", description: pc.localDescription });
          }
        } else if (payload.kind === "ice") {
          if (!pc.remoteDescription || !pc.remoteDescription.type)
            peer.pendingCandidates.push(payload.candidate);
          else
            try {
              await pc.addIceCandidate(payload.candidate);
            } catch (err) {
              if (!peer.ignoreOffer) throw err;
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
      const ctx = await ensureCtx();
      const pipe = createMicPipeline(ctx, raw, useAppStore.getState().micLevel);
      rawMicRef.current = raw;
      micPipeRef.current = pipe;
      const track = pipe.stream.getAudioTracks()[0];
      track.contentHint = "speech";
      analysersRef.current.set(userId!, pipe.analyser);
      log("mic pipeline ready; ctx=", ctx.state, "rate", ctx.sampleRate);
      raw.getAudioTracks()[0].onended = () => {
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
        return false;
      }
      if (!micTrack) return false;
      useAppStore.getState().setMicError(null);

      camStreamRef.current = new MediaStream();
      screenStreamRef.current = new MediaStream();
      const mic = new MediaStream([micTrack]);
      mic.getAudioTracks().forEach((t) => (t.enabled = isMicLive(useAppStore.getState())));
      localStreamRef.current = mic;
      setLocalStream(mic);
      await ensureOutput();

      const sig = supabase.channel(`voice:${channelId}`, {
        config: { private: true, presence: { key: userId }, broadcast: { self: false } },
      });
      sigRef.current = sig;
      sig
        .on("broadcast", { event: "signal" }, ({ payload }) => handleSignal(payload))
        .on("broadcast", { event: "roles" }, ({ payload }) => {
          const { from, camId, screenId } = payload as {
            from: string;
            camId: string | null;
            screenId: string | null;
          };
          const peer = peersRef.current.get(from);
          if (!peer) return;
          const prevScreen = peer.roles.screenId;
          peer.roles = { camId, screenId };
          // Single active screen: someone else just started → stop mine.
          if (screenId && !prevScreen && from !== userId && screenTrackRef.current)
            stopScreenShareRef.current();
          reclassify(from);
        })
        .on("broadcast", { event: "screen-max" }, ({ payload }) => {
          const { target, on } = payload as { target: string; on: boolean };
          setMaximizedScreen(on ? target : null);
        })
        .on("presence", { event: "sync" }, () => {
          const ids = Object.keys(sig.presenceState()).filter((k) => k !== userId);
          for (const id of ids) createPeer(id);
          for (const known of peersRef.current.keys())
            if (!ids.includes(known)) closePeer(known);
          sendRoles(); // let new peers learn our camera/screen ids
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            await sig.track({ joined_at: new Date().toISOString() });
            setConnected(true);
            sendRoles();
            await supabase.from("active_status").upsert({
              user_id: userId,
              is_online: true,
              current_voice_channel: channelId,
              updated_at: new Date().toISOString(),
            });
          }
        });

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
    [userId, buildMicPipeline, ensureOutput, handleSignal, createPeer, closePeer, reclassify, sendRoles]
  );

  const leave = useCallback(async () => {
    if (speakTimerRef.current) clearInterval(speakTimerRef.current);
    speakTimerRef.current = null;
    for (const id of [...peersRef.current.keys()]) closePeer(id);
    camTrackRef.current?.stop();
    camTrackRef.current = null;
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    camStreamRef.current = null;
    screenStreamRef.current = null;
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
    setMaximizedScreen(null);
    setConnected(false);
    if (sigRef.current) {
      await supabase.removeChannel(sigRef.current);
      sigRef.current = null;
    }
    if (userId)
      await supabase.from("active_status").upsert({
        user_id: userId,
        is_online: true,
        current_voice_channel: null,
        updated_at: new Date().toISOString(),
      });
  }, [userId, closePeer]);

  /* ── Camera (addTrack + renegotiation) ────────────────────────────── */
  const setCamera = useCallback(
    async (on: boolean, quality: VideoQuality) => {
      if (!camStreamRef.current) return;
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
        camStreamRef.current.addTrack(track);
        track.onended = () => useAppStore.getState().setCamOn(false);
        for (const p of peersRef.current.values())
          p.pc.addTrack(track, camStreamRef.current);
        sendRoles();
        bumpLocal();
      } else if (!on && camTrackRef.current) {
        const track = camTrackRef.current;
        camTrackRef.current = null;
        for (const p of peersRef.current.values()) {
          const sender = p.pc.getSenders().find((s) => s.track === track);
          if (sender) p.pc.removeTrack(sender);
        }
        camStreamRef.current.removeTrack(track);
        track.stop();
        sendRoles();
        bumpLocal();
      }
    },
    [sendRoles, bumpLocal]
  );

  /* ── Screen share (addTrack + renegotiation, single active) ───────── */
  const stopScreenShareImpl = useCallback(async () => {
    const track = screenTrackRef.current;
    if (!track || !screenStreamRef.current) return;
    screenTrackRef.current = null;
    for (const p of peersRef.current.values()) {
      const sender = p.pc.getSenders().find((s) => s.track === track);
      if (sender) p.pc.removeTrack(sender);
    }
    screenStreamRef.current.removeTrack(track);
    track.stop();
    setLocalScreen(null);
    sendRoles();
    sigRef.current?.send({
      type: "broadcast",
      event: "screen-max",
      payload: { target: userId, on: false },
    });
  }, [sendRoles, userId]);
  stopScreenShareRef.current = () => void stopScreenShareImpl();

  const startScreenShare = useCallback(async () => {
    if (screenTrackRef.current || !screenStreamRef.current) return;
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
    screenStreamRef.current.addTrack(track);
    track.onended = () => void stopScreenShareImpl();
    setLocalScreen(new MediaStream([track]));
    for (const p of peersRef.current.values())
      p.pc.addTrack(track, screenStreamRef.current);
    sendRoles(); // announces our screenId → overrides any prior sharer
  }, [sendRoles, stopScreenShareImpl]);

  const toggleMaximize = useCallback(
    (target: string) => {
      const on = maximizedScreen !== target;
      setMaximizedScreen(on ? target : null);
      sigRef.current?.send({
        type: "broadcast",
        event: "screen-max",
        payload: { target, on },
      });
    },
    [maximizedScreen]
  );

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

  /* ── Volume (all local) ───────────────────────────────────────────── */
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
    stopScreenShare: stopScreenShareImpl,
    toggleMaximize,
    applyMicLevel,
    applyMasterVolume,
    setPeerVolume,
    applyOutputSink,
    localStream,
    remoteStreams,
    localScreen,
    remoteScreens,
    speakingIds,
    maximizedScreen,
    connected,
  };
}
