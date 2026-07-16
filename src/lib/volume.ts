/**
 * Volume UI scale.
 *
 * The Web Audio GainNodes run on a raw multiplier in [0 – 4.0] — 400%
 * headroom so a quiet friend can be boosted well past unity. The UI, though,
 * shows a friendly 0–100 scale that maps LINEARLY onto that range:
 *
 *   UI 100 → gain 4.0   ·   UI 50 → gain 2.0   ·   UI 25 → gain 1.0 (unity)
 *
 * Keep every slider (mic, master, per-user) on this scale so the numbers
 * stay consistent across the app while the high-gain capacity lives on
 * untouched in the background.
 */
export const MAX_GAIN = 4;

/** Gain multiplier (0–4) → UI value (0–100). */
export const gainToUi = (gain: number) => Math.round((gain / MAX_GAIN) * 100);

/** UI value (0–100) → gain multiplier (0–4). */
export const uiToGain = (ui: number) => (ui / 100) * MAX_GAIN;
