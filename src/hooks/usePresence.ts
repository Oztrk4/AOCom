"use client";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/app-store";

/**
 * Global online presence: every logged-in client joins the "online" presence
 * channel; the synced key set drives the green dots in the friends list.
 * Mirrors is_online into active_status so it also survives in the DB.
 */
export function usePresence(userId: string | null) {
  const setOnlineIds = useAppStore((s) => s.setOnlineIds);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase.channel("presence:online", {
      config: { private: true, presence: { key: userId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        setOnlineIds(Object.keys(channel.presenceState()));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
          await supabase.from("active_status").upsert({
            user_id: userId,
            is_online: true,
            updated_at: new Date().toISOString(),
          });
        }
      });

    const markOffline = () => {
      // Best-effort; presence handles the authoritative signal.
      void supabase.from("active_status").upsert({
        user_id: userId,
        is_online: false,
        current_voice_channel: null,
        updated_at: new Date().toISOString(),
      });
    };
    window.addEventListener("beforeunload", markOffline);

    return () => {
      window.removeEventListener("beforeunload", markOffline);
      markOffline();
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
