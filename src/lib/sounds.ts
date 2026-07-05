/**
 * Discord-style call chimes, synthesized with the Web Audio API — no
 * bundled audio assets, so the strict CSP and tiny installer stay intact.
 * Each start* function begins a loop and returns its stop() function.
 */
let ctx: AudioContext | null = null;

function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  void ctx.resume();
  return ctx;
}

function tone(
  c: AudioContext,
  freq: number,
  start: number,
  dur: number,
  vol = 0.1,
  type: OscillatorType = "sine"
) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(vol, start + 0.02);
  gain.gain.setValueAtTime(vol, Math.max(start + 0.02, start + dur - 0.08));
  gain.gain.linearRampToValueAtTime(0, start + dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/** Caller side: soft two-pulse ringback chord (A4 + C#5), every 2.4s. */
export function startOutgoingRing(): () => void {
  const c = audioCtx();
  const play = () => {
    const t = c.currentTime + 0.05;
    tone(c, 440.0, t, 0.35, 0.08);
    tone(c, 554.37, t, 0.35, 0.06);
    tone(c, 440.0, t + 0.5, 0.35, 0.08);
    tone(c, 554.37, t + 0.5, 0.35, 0.06);
  };
  play();
  const loop = setInterval(play, 2400);
  return () => clearInterval(loop);
}

/** Callee side: brighter ascending triad (C5→E5→G5), more urgent, every 1.6s. */
export function startIncomingRing(): () => void {
  const c = audioCtx();
  const play = () => {
    const t = c.currentTime + 0.05;
    tone(c, 523.25, t, 0.18, 0.11, "triangle");
    tone(c, 659.25, t + 0.2, 0.18, 0.11, "triangle");
    tone(c, 783.99, t + 0.4, 0.3, 0.12, "triangle");
  };
  play();
  const loop = setInterval(play, 1600);
  return () => clearInterval(loop);
}
