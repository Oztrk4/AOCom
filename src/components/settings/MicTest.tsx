"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MIC_CONSTRAINTS, applySinkId, buildVoiceFilterChain } from "@/lib/media";
import { MicIcon } from "@/components/ui/icons";

/**
 * Isolated microphone loopback test.
 *
 * SAFETY GUARD: this component opens its *own* getUserMedia stream and
 * routes it AudioContext → AnalyserNode → MediaStreamAudioDestinationNode
 * → a private <audio> element. Nothing here ever touches useWebRTC's
 * streams or any RTCPeerConnection, so friends in a voice channel hear
 * absolutely nothing from the test — isolation by construction.
 */
export function MicTest({
  micDeviceId,
  speakerDeviceId,
}: {
  micDeviceId: string | null;
  speakerDeviceId: string | null;
}) {
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);
  const smoothRef = useRef(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    smoothRef.current = 0;
    setLevel(0);
    audioElRef.current?.pause();
    if (audioElRef.current) audioElRef.current.srcObject = null;
    audioElRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
    setTesting(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...MIC_CONSTRAINTS,
          ...(micDeviceId ? { deviceId: { exact: micDeviceId } } : {}),
        },
      });
    } catch {
      setError("Couldn't open the microphone for the test.");
      return;
    }
    streamRef.current = stream;

    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    // Same voice-optimization chain as the live call, so the loopback is
    // a faithful preview of what friends actually hear.
    const chain = buildVoiceFilterChain(ctx);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    const destination = ctx.createMediaStreamDestination();
    source.connect(chain.input);
    chain.output.connect(analyser);
    analyser.connect(destination);

    // Private playback element — respects the chosen output device.
    const audio = new Audio();
    audio.srcObject = destination.stream;
    await applySinkId(audio, speakerDeviceId);
    void audio.play();
    audioElRef.current = audio;

    // RMS volume meter with gentle decay for a smooth, matte feel.
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += (v - 128) * (v - 128);
      const rms = Math.sqrt(sum / buf.length) / 128; // 0..1
      smoothRef.current = Math.max(rms, smoothRef.current * 0.88);
      setLevel(smoothRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    setTesting(true);
  }, [micDeviceId, speakerDeviceId]);

  // Follow live device changes during an active test; clean up on unmount.
  useEffect(() => {
    if (testing) {
      stop();
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micDeviceId]);

  useEffect(() => {
    if (audioElRef.current) void applySinkId(audioElRef.current, speakerDeviceId);
  }, [speakerDeviceId]);

  useEffect(() => stop, [stop]);

  const pct = Math.min(100, Math.round(level * 260));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button
          onClick={() => (testing ? stop() : void start())}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors ${
            testing
              ? "bg-danger text-white"
              : "bg-bg-3 text-text-0 hover:bg-accent-soft"
          }`}
        >
          <MicIcon width={13} height={13} />
          {testing ? "Stop Test" : "Test Microphone"}
        </button>
        {/* Volume meter — flat matte fill, no glow */}
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-3">
          <div
            className="h-full rounded-full transition-[width] duration-75 ease-out"
            style={{
              width: `${pct}%`,
              background:
                "linear-gradient(90deg, var(--accent), var(--accent-2))",
            }}
          />
        </div>
      </div>
      {testing && (
        <p className="text-[10px] text-text-1">
          You should hear yourself now. This loopback is fully local — nobody
          in a voice channel can hear it.
        </p>
      )}
      {error && <p className="text-[10px] text-danger">{error}</p>}
    </div>
  );
}
