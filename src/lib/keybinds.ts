/** Push-to-talk keybind utilities. */

/** Hang time: keeps the mic open briefly after release so trailing words
 *  ("…okay GO") are never clipped mid-syllable. */
export const PTT_HANG_MS = 100;

export type MouseKey = "Mouse4" | "Mouse5";

export function isMouseKey(key: string): key is MouseKey {
  return key === "Mouse4" || key === "Mouse5";
}

/** MouseEvent.button → our side-button names (3 = back, 4 = forward). */
export function mouseButtonToKey(button: number): MouseKey | null {
  if (button === 3) return "Mouse4";
  if (button === 4) return "Mouse5";
  return null;
}

export function mouseKeyToButton(key: MouseKey): number {
  return key === "Mouse4" ? 3 : 4;
}

/**
 * Map a KeyboardEvent.code to a Tauri global-shortcut accelerator.
 * Returns null for keys the OS hotkey API can't register on its own
 * (bare modifiers like Ctrl/Alt/Shift, lock keys, etc.).
 */
export function codeToAccelerator(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  switch (code) {
    case "Space": return "Space";
    case "Backquote": return "`";
    case "Minus": return "-";
    case "Equal": return "=";
    case "BracketLeft": return "[";
    case "BracketRight": return "]";
    case "Backslash": return "\\";
    case "Semicolon": return ";";
    case "Quote": return "'";
    case "Comma": return ",";
    case "Period": return ".";
    case "Slash": return "/";
    case "Insert": return "Insert";
    case "Delete": return "Delete";
    case "Home": return "Home";
    case "End": return "End";
    case "PageUp": return "PageUp";
    case "PageDown": return "PageDown";
    default: return null;
  }
}
