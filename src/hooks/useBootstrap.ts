"use client";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/app-store";
import type { ActiveStatus, Channel, Profile } from "@/lib/types";

/**
 * Loads channels, all squad profiles and voice/online statuses once after
 * login, then keeps them fresh via Supabase Realtime (postgres_changes).
 */
export function useBootstrap(userId: string | null) {
  const {
    setProfile,
    setProfiles,
    upsertProfile,
    setChannels,
    setActiveTextChannel,
    setStatuses,
    upsertStatus,
  } = useAppStore();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      const [{ data: profiles }, { data: channels }, { data: statuses }] =
        await Promise.all([
          supabase.from("profiles").select("*"),
          supabase.from("channels").select("*").order("created_at"),
          supabase.from("active_status").select("*"),
        ]);
      if (cancelled) return;

      if (profiles) {
        setProfiles(profiles as Profile[]);
        const me = (profiles as Profile[]).find((p) => p.id === userId);
        if (me) setProfile(me);
      }
      if (channels) {
        setChannels(channels as Channel[]);
        const firstText = (channels as Channel[]).find((c) => c.type === "text");
        if (firstText) setActiveTextChannel(firstText);
      }
      if (statuses) setStatuses(statuses as ActiveStatus[]);
    })();

    const dbChanges = supabase
      .channel("db-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "active_status" },
        (payload) => {
          if (payload.new && "user_id" in payload.new)
            upsertStatus(payload.new as ActiveStatus);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        (payload) => {
          if (payload.new && "id" in payload.new) {
            const p = payload.new as Profile;
            upsertProfile(p);
            if (p.id === userId) setProfile(p);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "channels" },
        async () => {
          // Admin CRUD syncs instantly: refetch the (tiny) channel list
          // and heal the active selection if it was renamed or deleted.
          const { data } = await supabase
            .from("channels")
            .select("*")
            .order("created_at");
          if (!data) return;
          const list = data as Channel[];
          setChannels(list);
          const st = useAppStore.getState();
          const activeId = st.activeTextChannel?.id;
          const stillThere = list.find((c) => c.id === activeId);
          if (stillThere) st.setActiveTextChannel(stillThere);
          else st.setActiveTextChannel(list.find((c) => c.type === "text") ?? null);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(dbChanges);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
