/** Microphone permission, device-routing and voice-pipeline helpers. */

/**
 * Hardware capture constraints. autoGainControl is strictly OFF: the
 * browser's AGC treats sustained flat sounds ("AAAA", laughing, singing)
 * as background noise and ducks them hard — the gating bug. Echo
 * cancellation + noise suppression stay on; level control moves to our
 * own Web Audio chain below, which never gates.
 */
export const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false,
};

/**
 * Voice optimization chain: high-pass kills desk rumble and mic thumps,
 * low-pass shaves the sharp broadband edge of keyboard/mouse clicks
 * (voice lives well below 11 kHz), and a fast soft-knee compressor tames
 * remaining transient spikes. Crucially there is NO gate anywhere in the
 * chain — sustained vocal delivery passes untouched, never dropped or
 * clipped.
 */
export function buildVoiceFilterChain(ctx: AudioContext): {
  input: AudioNode;
  output: AudioNode;
} {
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 90;
  highpass.Q.value = 0.7;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 11000;
  lowpass.Q.value = 0.7;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 18;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003; // fast enough to catch key clicks
  compressor.release.value = 0.15; // slow enough to never pump speech

  highpass.connect(lowpass);
  lowpass.connect(compressor);
  return { input: highpass, output: compressor };
}

export interface ProcessedMic {
  /** The cleaned stream whose audio track is sent to peers. */
  stream: MediaStream;
  /** Tear the graph down when the raw capture is retired. */
  disconnect: () => void;
}

/** Route a raw mic capture through the voice chain; peers get the output. */
export function processMicStream(
  ctx: AudioContext,
  raw: MediaStream
): ProcessedMic {
  const source = ctx.createMediaStreamSource(raw);
  const chain = buildVoiceFilterChain(ctx);
  const destination = ctx.createMediaStreamDestination();
  source.connect(chain.input);
  chain.output.connect(destination);
  return {
    stream: destination.stream,
    disconnect: () => {
      source.disconnect();
      chain.output.disconnect();
    },
  };
}

/**
 * Route a media element's audio to the chosen output device (speakers /
 * headset) live, without interrupting playback. No-ops on null (system
 * default) or when the platform lacks setSinkId.
 */
export async function applySinkId(
  el: HTMLMediaElement,
  deviceId: string | null
) {
  if (!deviceId) return;
  const sinkable = el as HTMLMediaElement & {
    setSinkId?: (id: string) => Promise<void>;
  };
  try {
    await sinkable.setSinkId?.(deviceId);
  } catch {
    /* unknown/unplugged sink — keep default routing */
  }
}

export function describeMediaError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Microphone access is blocked. Use “Reset Media Permissions” in Settings to re-request it.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone detected. Plug one in and try again.";
    case "NotReadableError":
      return "The microphone is busy in another app. Close it and retry.";
    default:
      return "Could not start the microphone. Check your audio devices and retry.";
  }
}

/**
 * Re-trigger the OS/WebView microphone prompt. Returns null on success
 * (permission granted, test stream immediately released) or a
 * human-readable error message when still blocked.
 */
export async function requestMicAccess(): Promise<string | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return null;
  } catch (err) {
    return describeMediaError(err);
  }
}

export interface MediaResetResult {
  ok: boolean;
  error: string | null;
  /** Labeled audio inputs discovered after the permission grant. */
  inputs: string[];
}

/**
 * Hard reset of the media pipeline:
 *  1. drop any cached device list the webview holds (pre-enumeration),
 *  2. force a fresh permission grant via getUserMedia (the Rust layer
 *     auto-allows at the WebView2 level, so a past "Deny" cannot stick),
 *  3. re-enumerate devices — labels only populate once permission is
 *     live, so this doubles as proof the grant really went through.
 */
export async function resetMediaPipeline(): Promise<MediaResetResult> {
  // Step 1: prime/flush the device cache. Failures here are non-fatal.
  try {
    await navigator.mediaDevices.enumerateDevices();
  } catch {
    /* ignore */
  }

  // Step 2: force the actual permission grant.
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
  } catch (err) {
    return { ok: false, error: describeMediaError(err), inputs: [] };
  }

  // Step 3: robust re-enumeration with real labels.
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices
      .filter((d) => d.kind === "audioinput")
      .map((d, i) => d.label || `Microphone ${i + 1}`);
    if (inputs.length === 0) {
      return { ok: false, error: describeMediaError(new DOMException("", "NotFoundError")), inputs: [] };
    }
    return { ok: true, error: null, inputs };
  } catch (err) {
    return { ok: false, error: describeMediaError(err), inputs: [] };
  }
}
