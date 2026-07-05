"use client";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

const HEARTBEAT_MS = 60_000;

/**
 * "Last seen" heartbeat: stamps profiles.last_seen_at on mount, every
 * minute while the app runs, on window focus, and (best-effort) on exit.
 * Everyone's friends list stays fresh via the existing profiles realtime
 * subscription.
 */
export function useHeartbeat(userId: string | null) {
  useEffect(() => {
    if (!userId) return;

    const beat = () => {
      void supabase
        .from("profiles")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", userId);
    };

    beat();
    const interval = setInterval(beat, HEARTBEAT_MS);
    window.addEventListener("focus", beat);
    window.addEventListener("beforeunload", beat);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", beat);
      window.removeEventListener("beforeunload", beat);
      beat(); // final stamp on logout/unmount
    };
  }, [userId]);
}
