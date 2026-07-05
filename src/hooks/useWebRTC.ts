"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { isMicLive, useAppStore } from "@/stores/app-store";
import { QUALITY_PRESETS, type VideoQuality } from "@/lib/types";
import {
  MIC_CONSTRAINTS,
  describeMediaError,
  processMicStream,
  type ProcessedMic,
} from "@/lib/media";

/**
 * Full-mesh P2P WebRTC. Media never touches a server: Supabase Realtime
 * broadcast is used only for lightweight SDP/ICE signaling (free tier),
 * then audio/video flows directly between peers via STUN-discovered routes.
 *
 * Glare is resolved with the "perfect negotiation" pattern; politeness is
 * derived deterministically from user-id ordering so both sides agree.
 *
 * Camera latency: every peer connection pre-negotiates a video transceiver
 * at setup time, so toggling the webcam is a pure `replaceTrack()` — no
 * SDP renegotiation, no signaling round-trip, instant on/off.
 */
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ],
};

type Signal =
  | { kind: "sdp"; description: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

interface Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Composite stream we assemble from ontrack events. */
  stream: MediaStream | null;
  /** Pre-negotiated video sender — camera toggles via replaceTrack only. */
  videoSender: RTCRtpSender | null;
}

export function useWebRTC(userId: string | null) {
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const sigRef = useRef<RealtimeChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  /** Raw hardware capture — kept only to release the device on teardown. */
  const rawMicRef = useRef<MediaStream | null>(null);
  /** Web Audio voice-optimization graph feeding the outgoing track. */
  const micGraphRef = useRef<ProcessedMic | null>(null);
  const camTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<Map<string, AnalyserNode>>(new Map());
  const speakTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
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

  /** Refresh the local stream state so self-tile UI re-renders instantly. */
  const bumpLocal = useCallback(() => {
    const local = localStreamRef.current;
    setLocalStream(local ? new MediaStream(local.getTracks()) : null);
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

  const attachAnalyser = useCallback((id: string, stream: MediaStream) => {
    if (!stream.getAudioTracks().length) return;
    if (!audioCtxRef.current)
      audioCtxRef.current = new AudioContext({ latencyHint: "interactive" });
    const ctx = audioCtxRef.current;
    void ctx.resume();
    analysersRef.current.get(id)?.disconnect();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    analysersRef.current.set(id, analyser);
  }, []);

  const closePeer = useCallback(
    (peerId: string) => {
      const peer = peersRef.current.get(peerId);
      if (!peer) return;
      peer.pc.onnegotiationneeded = null;
      peer.pc.onicecandidate = null;
      peer.pc.ontrack = null;
      peer.pc.close();
      peersRef.current.delete(peerId);
      analysersRef.current.get(peerId)?.disconnect();
      analysersRef.current.delete(peerId);
      bumpRemote(peerId, null);
    },
    [bumpRemote]
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
        videoSender: null,
      };
      peersRef.current.set(peerId, peer);

      const local = localStreamRef.current;
      if (local)
        for (const track of local.getAudioTracks()) {
          const sender = pc.addTrack(track, local);
          // Priority queue for voice: high bandwidth allocation + DSCP
          // network marking so audio packets outrank everything else
          // the connection carries, keeping jitter flat under load.
          const params = sender.getParameters();
          if (params.encodings.length) {
            params.encodings[0].priority = "high";
            params.encodings[0].networkPriority = "high";
            void sender.setParameters(params).catch(() => {});
          }
        }

      // Reserve the video m-line up front. From here on, camera on/off is
      // replaceTrack() — never a renegotiation.
      const videoTransceiver = pc.addTransceiver("video", {
        direction: "sendrecv",
      });
      peer.videoSender = videoTransceiver.sender;
      if (camTrackRef.current)
        void videoTransceiver.sender.replaceTrack(camTrackRef.current);

      pc.onnegotiationneeded = async () => {
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription)
            sendSignal(peerId, { kind: "sdp", description: pc.localDescription });
        } catch (err) {
          console.error("negotiation failed", err);
        } finally {
          peer.makingOffer = false;
        }
      };

      pc.onicecandidate = (e) => {
        if (e.candidate)
          sendSignal(peerId, { kind: "ice", candidate: e.candidate.toJSON() });
      };

      pc.ontrack = (e) => {
        // Assemble a composite stream per peer (transceiver tracks arrive
        // without a stream association).
        if (!peer.stream) peer.stream = new MediaStream();
        if (!peer.stream.getTracks().includes(e.track))
          peer.stream.addTrack(e.track);
        const stream = peer.stream;
        // A remote camera-off is a muted (frameless) video track, not a
        // removed one — re-render the tile on both transitions.
        e.track.onmute = () => bumpRemote(peerId, stream);
        e.track.onunmute = () => bumpRemote(peerId, stream);
        bumpRemote(peerId, stream);
        if (e.track.kind === "audio") attachAnalyser(peerId, stream);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          pc.restartIce();
        }
      };

      return peer;
    },
    [userId, sendSignal, bumpRemote, attachAnalyser]
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
          if (desc.type === "offer") {
            await pc.setLocalDescription();
            if (pc.localDescription)
              sendSignal(peerId, { kind: "sdp", description: pc.localDescription });
          }
        } else if (payload.kind === "ice") {
          try {
            await pc.addIceCandidate(payload.candidate);
          } catch (err) {
            if (!peer.ignoreOffer) throw err;
          }
        }
      } catch (err) {
        console.error("signal handling failed", err);
      }
    },
    [userId, createPeer, sendSignal]
  );

  /** Join a voice channel: capture mic, open signaling, mesh with peers. */
  const join = useCallback(
    async (channelId: string): Promise<boolean> => {
      if (!userId) return false;

      const preferredMic = useAppStore.getState().micDeviceId;
      let raw: MediaStream;
      try {
        raw = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...MIC_CONSTRAINTS,
            ...(preferredMic ? { deviceId: { ideal: preferredMic } } : {}),
          },
        });
        useAppStore.getState().setMicError(null);
      } catch (err) {
        useAppStore.getState().setMicError(describeMediaError(err));
        return false;
      }

      // Peers receive the filtered/compressed track, never the raw one.
      // latencyHint "interactive" pins the smallest stable buffer size,
      // and the Web Audio rendering thread runs at realtime OS priority.
      if (!audioCtxRef.current)
        audioCtxRef.current = new AudioContext({ latencyHint: "interactive" });
      void audioCtxRef.current.resume();
      const graph = processMicStream(audioCtxRef.current, raw);
      rawMicRef.current = raw;
      micGraphRef.current = graph;
      const mic = new MediaStream(graph.stream.getAudioTracks());
      mic.getAudioTracks().forEach((t) => (t.contentHint = "speech"));
      localStreamRef.current = mic;
      setLocalStream(mic);
      attachAnalyser(userId, mic);
      // PTT mode: joins hard-muted until the key is pressed.
      mic.getAudioTracks().forEach(
        (t) => (t.enabled = isMicLive(useAppStore.getState()))
      );

      const sig = supabase.channel(`voice:${channelId}`, {
        config: {
          presence: { key: userId },
          broadcast: { self: false },
        },
      });
      sigRef.current = sig;

      sig
        .on("broadcast", { event: "signal" }, ({ payload }) =>
          handleSignal(payload)
        )
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

      // Poll analysers for active-speaker glow (~5 Hz keeps CPU negligible).
      speakTimerRef.current = setInterval(() => {
        const buf = new Uint8Array(256);
        const now = new Set<string>();
        for (const [id, analyser] of analysersRef.current) {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += (v - 128) * (v - 128);
          if (Math.sqrt(sum / buf.length) > 6) now.add(id);
        }
        setSpeakingIds((prev) => {
          if (prev.size === now.size && [...prev].every((x) => now.has(x)))
            return prev;
          return now;
        });
      }, 200);

      return true;
    },
    [userId, attachAnalyser, handleSignal, createPeer, closePeer]
  );

  /** Leave the voice channel and tear everything down. */
  const leave = useCallback(async () => {
    if (speakTimerRef.current) clearInterval(speakTimerRef.current);
    speakTimerRef.current = null;

    for (const id of [...peersRef.current.keys()]) closePeer(id);

    camTrackRef.current?.stop();
    camTrackRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    micGraphRef.current?.disconnect();
    micGraphRef.current = null;
    rawMicRef.current?.getTracks().forEach((t) => t.stop());
    rawMicRef.current = null;
    setLocalStream(null);
    setRemoteStreams({});
    setSpeakingIds(new Set());
    setConnected(false);

    if (sigRef.current) {
      await supabase.removeChannel(sigRef.current);
      sigRef.current = null;
    }
    analysersRef.current.forEach((a) => a.disconnect());
    analysersRef.current.clear();

    if (userId) {
      await supabase.from("active_status").upsert({
        user_id: userId,
        is_online: true,
        current_voice_channel: null,
        updated_at: new Date().toISOString(),
      });
    }
  }, [userId, closePeer]);

  /**
   * Instant camera toggle: the video m-line was negotiated at connection
   * time, so this is capture + replaceTrack fan-out (or replaceTrack(null)
   * + hard stop). No renegotiation, no signaling, no dropdown required.
   */
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
            (p) => p.videoSender?.replaceTrack(track) ?? Promise.resolve()
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
            (p) => p.videoSender?.replaceTrack(null) ?? Promise.resolve()
          )
        );
      }
    },
    [bumpLocal]
  );

  /**
   * Live quality switch (360p/480p/720p) via applyConstraints on the
   * running track — the encoder rescales in place, the pipeline never
   * stops, and peers see a smooth resolution change.
   */
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
    } catch {
      /* device can't do this mode — keep streaming at current settings */
    }
  }, []);

  /**
   * Hot-swap the microphone without leaving the call: capture the new
   * device, replaceTrack on every peer's audio sender, retire the old
   * track. Peers notice nothing but the new voice.
   */
  const setMicDevice = useCallback(
    async (deviceId: string | null) => {
      const local = localStreamRef.current;
      if (!local || !userId) return;
      try {
        const freshRaw = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...MIC_CONSTRAINTS,
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          },
        });
        if (!audioCtxRef.current)
          audioCtxRef.current = new AudioContext({ latencyHint: "interactive" });
        const graph = processMicStream(audioCtxRef.current, freshRaw);
        const newTrack = graph.stream.getAudioTracks()[0];
        newTrack.contentHint = "speech";
        newTrack.enabled = isMicLive(useAppStore.getState());

        await Promise.all(
          [...peersRef.current.values()].map((p) => {
            const sender = p.pc
              .getSenders()
              .find((s) => s.track?.kind === "audio");
            return sender ? sender.replaceTrack(newTrack) : Promise.resolve();
          })
        );

        const oldTrack = local.getAudioTracks()[0];
        if (oldTrack) {
          local.removeTrack(oldTrack);
          oldTrack.stop();
        }
        local.addTrack(newTrack);
        // Retire the previous graph + hardware capture completely.
        micGraphRef.current?.disconnect();
        rawMicRef.current?.getTracks().forEach((t) => t.stop());
        micGraphRef.current = graph;
        rawMicRef.current = freshRaw;
        attachAnalyser(userId, new MediaStream([newTrack]));
        bumpLocal();
      } catch (err) {
        useAppStore.getState().setMicError(describeMediaError(err));
      }
    },
    [userId, attachAnalyser, bumpLocal]
  );

  const setMicEnabled = useCallback((enabled: boolean) => {
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }, []);

  // Full teardown if the component unmounts mid-call.
  useEffect(() => () => void leave(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    join,
    leave,
    setCamera,
    applyQuality,
    setMicDevice,
    setMicEnabled,
    localStream,
    remoteStreams,
    speakingIds,
    connected,
  };
}
