"use client";
import { useEffect, useRef, useState } from "react";
import { SmileIcon } from "@/components/ui/icons";

const EMOJIS = [
  "😀", "😁", "😂", "🤣", "😅", "😊", "😍", "😘",
  "😎", "🤔", "🤨", "😏", "😴", "🥱", "😮", "😱",
  "😭", "🥺", "😤", "😡", "🤬", "🤯", "🥶", "🥵",
  "🤢", "🤮", "🤡", "💀", "👻", "🤖", "😈", "🫠",
  "👍", "👎", "👊", "✊", "🤝", "👏", "🙌", "🙏",
  "💪", "✌️", "🤞", "🫡", "👀", "🔥", "💯", "⚡",
  "✨", "🎉", "🎊", "❤️", "💔", "🧡", "💚", "💙",
  "🎮", "🕹️", "🏆", "🥇", "🎯", "🎲", "🚀", "☠️",
];

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`rounded p-1.5 transition-colors ${
          open ? "text-accent" : "text-text-1 hover:text-accent"
        }`}
        aria-label="Emoji seç"
      >
        <SmileIcon />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-30 mb-2 w-72 rounded-xl border border-edge bg-bg-1 p-2 shadow-2xl">
          <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => onPick(e)}
                className="rounded-md p-1 text-lg transition-colors hover:bg-accent-soft"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
