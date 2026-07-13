"use client";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { isTauri } from "@/lib/tauri";

/**
 * Fix 4: closing the desktop app while sitting in a voice channel used to
 * leave the user "stuck" in the lobby (their active_status still pointed at
 * the channel). Intercept Tauri's CloseRequested, run a synchronous
 * presence/session cleanup, then destroy the window so the process exits
 * cleanly. Also stamps last_seen_at so the directory shows a real time.
 */
export function useCleanExit(userId: string | null) {
  useEffect(() => {
    if (!userId || !isTauri()) return;
    let unlisten: (() => void) | undefined;
    let closing = false;

    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      unlisten = await win.onCloseRequested(async (event) => {
        if (closing) return;
        closing = true;
        event.preventDefault(); // hold the close until cleanup finishes
        const now = new Date().toISOString();
        try {
          await supabase.from("active_status").upsert({
            user_id: userId,
            is_online: false,
            current_voice_channel: null,
            updated_at: now,
          });
          await supabase
            .from("profiles")
            .update({ last_seen_at: now })
            .eq("id", userId);
        } catch {
          /* best effort — exit regardless */
        }
        await win.destroy();
      });
    })();

    return () => unlisten?.();
  }, [userId]);
}
