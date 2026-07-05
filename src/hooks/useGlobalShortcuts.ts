"use client";
import { useEffect } from "react";
import { isTauri } from "@/lib/tauri";
import { useAppStore } from "@/stores/app-store";

export const SHORTCUT_MUTE = "CommandOrControl+Shift+M";
export const SHORTCUT_DEAFEN = "CommandOrControl+Shift+D";

/**
 * OS-level keybinds via the Tauri global-shortcut plugin. Registered with
 * the window manager, so they fire even while a fullscreen game has focus.
 * Fires on key *press* only (the plugin reports press and release).
 */
export function useGlobalShortcuts() {
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    (async () => {
      const { register, unregister } = await import(
        "@tauri-apps/plugin-global-shortcut"
      );
      const bind = async (accelerator: string, action: () => void) => {
        try {
          await unregister(accelerator).catch(() => {});
          if (cancelled) return;
          await register(accelerator, (event) => {
            if (event.state === "Pressed") action();
          });
        } catch (err) {
          console.warn(`global shortcut ${accelerator} unavailable`, err);
        }
      };

      await bind(SHORTCUT_MUTE, () => {
        const s = useAppStore.getState();
        s.setMuted(!s.muted);
      });
      await bind(SHORTCUT_DEAFEN, () => {
        const s = useAppStore.getState();
        s.setDeafened(!s.deafened);
      });
    })();

    return () => {
      cancelled = true;
      void import("@tauri-apps/plugin-global-shortcut").then(
        ({ unregister }) => {
          void unregister(SHORTCUT_MUTE).catch(() => {});
          void unregister(SHORTCUT_DEAFEN).catch(() => {});
        }
      );
    };
  }, []);
}
