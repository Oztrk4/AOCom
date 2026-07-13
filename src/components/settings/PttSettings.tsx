"use client";
import { useEffect, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { codeToAccelerator, isMouseKey, mouseButtonToKey } from "@/lib/keybinds";
import type { InputMode } from "@/lib/types";

const MODES: { id: InputMode; label: string; desc: string }[] = [
  { id: "voice", label: "Ses Etkinliği", desc: "Otomatik — mikrofon her zaman açık" },
  { id: "ptt", label: "Push-to-Talk", desc: "Bas Konuş — konuşmak için tuşu basılı tut" },
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
          "Bu tuş global kısayol olamaz (yalnız değiştirici/kilit tuşları). Bir harf, rakam, F-tuşu veya Boşluk dene."
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
        "Not: fare yan tuşları yalnızca AOCom odaktayken çalışır — oyun içi PTT için bir klavye tuşu ata."
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
      <label className="block text-[10px] font-semibold text-text-1">Giriş Modu</label>
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
          <span className="text-[10px] font-semibold text-text-1">Kısayol</span>
          <span
            className={`min-w-[64px] rounded-md border px-3 py-1.5 text-center font-mono text-xs font-bold ${
              pttKey
                ? "border-accent bg-accent-soft text-accent"
                : "border-edge bg-bg-3 text-text-1"
            }`}
          >
            {recording ? "…" : (pttKey ?? "atanmadı")}
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
            {recording ? "Bir tuşa bas… (Esc iptal)" : "Tuş Ata"}
          </button>
        </div>
      )}

      {inputMode === "ptt" && (
        <p className="text-[10px] leading-relaxed text-text-1">
          {hint ??
            (pttKey && !isMouseKey(pttKey)
              ? `“${pttKey}” AOCom çalışırken sistem genelinde rezervedir — tam ekran oyunlarda çalışır ama oyun bu tuşu görmez. Oyun içinde kullanmadığın bir tuş seç.`
              : pttKey
                ? "Fare yan tuşları yalnızca AOCom odaktayken çalışır — oyun içi PTT için bir klavye tuşu ata."
                : "Push-to-Talk için bir tuş ata. Atanana kadar PTT modunda mikrofonun kapalı kalır.")}
        </p>
      )}
    </div>
  );
}
