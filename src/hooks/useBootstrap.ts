"use client";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/app-store";
import { BAN_MESSAGE, type ActiveStatus, type Channel, type Profile } from "@/lib/types";

/** Ban enforcement: force the session out and leave the notice behind. */
async function kickBanned() {
  useAppStore.getState().setBanNotice(BAN_MESSAGE);
  await supabase.auth.signOut();
}

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
        if (me) {
          if (me.is_active === false) {
            void kickBanned();
            return;
          }
          setProfile(me);
        }
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
          if (payload.new && "user_id" in payload.new) {
            const st = payload.new as ActiveStatus;
            upsertStatus(st);
            // Admin "Kanaldan At": our own voice session was cleared by
            // someone else while we still think we're in a room → an admin
            // kicked us. Signal the Dashboard to force-leave the pipeline.
            if (
              st.user_id === userId &&
              !st.current_voice_channel &&
              useAppStore.getState().voiceChannel
            ) {
              useAppStore.getState().setKickedFromVoice(true);
            }
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        (payload) => {
          if (payload.new && "id" in payload.new) {
            const p = payload.new as Profile;
            upsertProfile(p);
            if (p.id === userId) {
              // Live ban: admin flips the switch → kicked mid-session.
              if (p.is_active === false) {
                void kickBanned();
                return;
              }
              setProfile(p);
            }
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
