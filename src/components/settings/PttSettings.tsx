"use client";
import { useEffect, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { codeToAccelerator, isMouseKey, mouseButtonToKey } from "@/lib/keybinds";
import type { InputMode } from "@/lib/types";

const MODES: { id: InputMode; label: string; desc: string }[] = [
  { id: "voice", label: "Voice Activity", desc: "Otomatik — mic is always open" },
  { id: "ptt", label: "Push-to-Talk", desc: "Bas Konuş — hold a key to speak" },
];

export function PttSettings() {
  const { inputMode, pttKey, setInputMode, setPttKey } = useAppStore();
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  // Keybind recorder: captures the next key press (or Mouse4/Mouse5)
  // globally within the window, Escape cancels.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setRecording(false);
        return;
      }
      const acc = codeToAccelerator(e.code);
      if (!acc) {
        setHint(
          "That key can't be a global hotkey (bare modifiers/lock keys). Try a letter, digit, F-key or Space."
        );
        return;
      }
      setPttKey(acc);
      setHint(null);
      setRecording(false);
    };
    const onMouse = (e: MouseEvent) => {
      const key = mouseButtonToKey(e.button);
      if (!key) return; // left/middle/right stay usable for the UI
      e.preventDefault();
      e.stopPropagation();
      setPttKey(key);
      setHint(
        "Heads-up: mouse side buttons only work while AOCom is focused — bind a keyboard key for in-game PTT."
      );
      setRecording(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onMouse, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onMouse, true);
    };
  }, [recording, setPttKey]);

  return (
    <div className="space-y-2">
      <label className="block text-[10px] font-semibold text-text-1">
        Input Mode
      </label>
      <div className="grid grid-cols-2 gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setInputMode(m.id)}
            className={`rounded-lg border p-2.5 text-left transition-colors ${
              inputMode === m.id
                ? "border-accent bg-accent-soft"
                : "border-edge bg-bg-3 hover:border-text-1"
            }`}
          >
            <p className="text-xs font-bold">{m.label}</p>
            <p className="text-[10px] text-text-1">{m.desc}</p>
          </button>
        ))}
      </div>

      {inputMode === "ptt" && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[10px] font-semibold text-text-1">Shortcut</span>
          <span
            className={`min-w-[64px] rounded-md border px-3 py-1.5 text-center font-mono text-xs font-bold ${
              pttKey
                ? "border-accent bg-accent-soft text-accent"
                : "border-edge bg-bg-3 text-text-1"
            }`}
          >
            {recording ? "…" : (pttKey ?? "not set")}
          </span>
          <button
            onClick={() => {
              setHint(null);
              setRecording((r) => !r);
            }}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors ${
              recording
                ? "animate-pulse bg-accent text-bg-0"
                : "bg-bg-3 text-text-0 hover:bg-accent-soft"
            }`}
          >
            {recording ? "Press any key… (Esc cancels)" : "Record Keybind"}
          </button>
        </div>
      )}

      {inputMode === "ptt" && (
        <p className="text-[10px] leading-relaxed text-text-1">
          {hint ??
            (pttKey && !isMouseKey(pttKey)
              ? `“${pttKey}” is reserved system-wide while AOCom runs — it works inside fullscreen games, but the game itself won't see it. Pick a key you don't use in-game.`
              : pttKey
                ? "Mouse side buttons only work while AOCom is focused — bind a keyboard key for in-game PTT."
                : "Record a key to activate Push-to-Talk. Until then your mic stays muted in PTT mode.")}
        </p>
      )}
    </div>
  );
}
