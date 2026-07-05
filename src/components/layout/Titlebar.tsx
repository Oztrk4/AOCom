"use client";
import { closeWindow, minimizeWindow, toggleMaximizeWindow } from "@/lib/tauri";
import { MinusIcon, SquareIcon, XIcon } from "@/components/ui/icons";

/** Custom titlebar for the frameless native window. */
export function Titlebar({ compact = false }: { compact?: boolean }) {
  return (
    <div
      data-tauri-drag-region
      className="flex h-8 shrink-0 items-center justify-between border-b border-edge bg-bg-1 pl-3"
    >
      <span
        data-tauri-drag-region
        className="pointer-events-none text-[11px] font-bold tracking-[0.25em] text-text-1"
      >
        AOCOM
      </span>
      <div className="flex h-full">
        <button
          onClick={minimizeWindow}
          className="flex h-full w-10 items-center justify-center text-text-1 transition-colors hover:bg-bg-2 hover:text-text-0"
          aria-label="Minimize"
        >
          <MinusIcon width={14} height={14} />
        </button>
        {!compact && (
          <button
            onClick={toggleMaximizeWindow}
            className="flex h-full w-10 items-center justify-center text-text-1 transition-colors hover:bg-bg-2 hover:text-text-0"
            aria-label="Maximize"
          >
            <SquareIcon width={12} height={12} />
          </button>
        )}
        <button
          onClick={closeWindow}
          className="flex h-full w-10 items-center justify-center text-text-1 transition-colors hover:bg-danger hover:text-white"
          aria-label="Close"
        >
          <XIcon width={14} height={14} />
        </button>
      </div>
    </div>
  );
}
