"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  fetchYouTubeMeta,
  loadYouTubeApi,
  parseYouTubeId,
} from "@/lib/youtube";
import type { QueueItem, RoomSession } from "@/lib/types";

const DRIFT_TOLERANCE = 1.5; // seconds before we force a re-seek

/**
 * Room-synchronized YouTube music player.
 *
 * State of truth is the `room_sessions` row (current track + is_playing +
 * position + updated_at); every client converges to it (best-effort,
 * sub-second — true ms-sync is not physically achievable over a network).
 * The upcoming `music_queue` and skip-votes ride the private `music:<id>`
 * Realtime channel. Per-user volume is purely local (player.setVolume).
 */
export function useMusicPlayer(
  channelId: string | null,
  userId: string,
  isAdmin: boolean
) {
  const [session, setSession] = useState<RoomSession | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [listeners, setListeners] = useState(1);
  const [skipVotes, setSkipVotes] = useState(0);
  const [localVolume, setLocalVolumeState] = useState(
    typeof window !== "undefined"
      ? Number(localStorage.getItem("aocom-music-vol") ?? "80")
      : 80
  );
  const [position, setPosition] = useState(0);

  const playerRef = useRef<any>(null);
  const loadedRef = useRef<string | null>(null);
  const sessionRef = useRef<RoomSession | null>(null);
  const chanRef = useRef<RealtimeChannel | null>(null);
  const leaderRef = useRef<string>(userId);
  const votesRef = useRef<Map<string, Set<string>>>(new Map());
  const volRef = useRef(localVolume);

  sessionRef.current = session;

  const isLeader = () => leaderRef.current === userId;

  /* ── Playback sync ────────────────────────────────────────────────── */
  const targetPosition = (s: RoomSession): number => {
    if (!s.is_playing) return s.position_seconds;
    const elapsed = (Date.now() - Date.parse(s.updated_at)) / 1000;
    return s.position_seconds + Math.max(0, elapsed);
  };

  const applySession = useCallback((s: RoomSession | null) => {
    const player = playerRef.current;
    if (!player || !player.loadVideoById) return;

    if (!s || !s.video_id) {
      loadedRef.current = null;
      try {
        player.stopVideo?.();
      } catch {}
      return;
    }

    const pos = targetPosition(s);
    if (s.video_id !== loadedRef.current) {
      loadedRef.current = s.video_id;
      votesRef.current.delete(s.video_id); // fresh track → fresh votes
      setSkipVotes(0);
      if (s.is_playing) player.loadVideoById(s.video_id, pos);
      else player.cueVideoById(s.video_id, pos);
      return;
    }
    // Same track → reconcile play/pause + drift.
    const state = player.getPlayerState?.(); // 1 playing, 2 paused
    if (s.is_playing && state !== 1) player.playVideo?.();
    if (!s.is_playing && state === 1) player.pauseVideo?.();
    const cur = player.getCurrentTime?.() ?? 0;
    if (Math.abs(cur - pos) > DRIFT_TOLERANCE) player.seekTo?.(pos, true);
  }, []);

  /** Persist a full session row (source of truth for every client). */
  const writeSession = useCallback(
    async (patch: Partial<RoomSession>) => {
      if (!channelId) return;
      const prev = sessionRef.current;
      const row = {
        channel_id: channelId,
        video_id: patch.video_id !== undefined ? patch.video_id : prev?.video_id ?? null,
        title: patch.title !== undefined ? patch.title : prev?.title ?? null,
        thumbnail: patch.thumbnail !== undefined ? patch.thumbnail : prev?.thumbnail ?? null,
        duration: patch.duration !== undefined ? patch.duration : prev?.duration ?? null,
        added_by: patch.added_by !== undefined ? patch.added_by : prev?.added_by ?? null,
        is_playing: patch.is_playing ?? prev?.is_playing ?? false,
        loop: patch.loop ?? prev?.loop ?? false,
        position_seconds:
          patch.position_seconds !== undefined
            ? patch.position_seconds
            : prev?.position_seconds ?? 0,
        updated_at: new Date().toISOString(),
      };
      await supabase.from("room_sessions").upsert(row);
    },
    [channelId]
  );

  const refetchQueue = useCallback(async () => {
    if (!channelId) return;
    const { data } = await supabase
      .from("music_queue")
      .select("*")
      .eq("channel_id", channelId)
      .order("created_at");
    setQueue((data as QueueItem[]) ?? []);
  }, [channelId]);

  /** Advance to the next queued track (or clear when the queue is empty). */
  const performNext = useCallback(async () => {
    if (!channelId) return;
    const { data } = await supabase
      .from("music_queue")
      .select("*")
      .eq("channel_id", channelId)
      .order("created_at")
      .limit(1);
    const head = (data as QueueItem[])?.[0];
    votesRef.current.clear();
    setSkipVotes(0);
    if (head) {
      await writeSession({
        video_id: head.video_id,
        title: head.title,
        thumbnail: head.thumbnail,
        duration: head.duration,
        added_by: head.added_by,
        is_playing: true,
        position_seconds: 0,
      });
      await supabase.from("music_queue").delete().eq("id", head.id);
    } else {
      await writeSession({
        video_id: null,
        title: null,
        thumbnail: null,
        duration: null,
        added_by: null,
        is_playing: false,
        position_seconds: 0,
      });
    }
  }, [channelId, writeSession]);

  /* ── Public controls ──────────────────────────────────────────────── */
  const playPause = useCallback(() => {
    const s = sessionRef.current;
    if (!s?.video_id) return;
    const pos = playerRef.current?.getCurrentTime?.() ?? s.position_seconds;
    void writeSession({ is_playing: !s.is_playing, position_seconds: pos });
  }, [writeSession]);

  const toggleLoop = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    void writeSession({ loop: !s.loop });
  }, [writeSession]);

  const prev = useCallback(() => {
    // No history table: "previous" restarts the current track.
    const s = sessionRef.current;
    if (!s?.video_id) return;
    void writeSession({ position_seconds: 0, is_playing: true });
  }, [writeSession]);

  const requestSkip = useCallback(() => {
    const s = sessionRef.current;
    if (!s?.video_id) return;
    // Register own vote + broadcast it.
    const set = votesRef.current.get(s.video_id) ?? new Set<string>();
    set.add(userId);
    votesRef.current.set(s.video_id, set);
    setSkipVotes(set.size);
    chanRef.current?.send({
      type: "broadcast",
      event: "skip-vote",
      payload: { from: userId, videoId: s.video_id },
    });
    // Leader may resolve immediately if the threshold is already met.
    const needed = Math.floor(listeners / 2) + 1;
    if (isLeader() && set.size >= needed) void performNext();
  }, [userId, listeners, performNext]);

  const next = useCallback(() => {
    const s = sessionRef.current;
    if (!s?.video_id) return;
    // Admin or the track's owner bypass the vote; everyone else votes.
    if (isAdmin || s.added_by === userId) void performNext();
    else requestSkip();
  }, [isAdmin, userId, performNext, requestSkip]);

  const addTrack = useCallback(
    async (input: string) => {
      if (!channelId) return null;
      const id = parseYouTubeId(input);
      if (!id) return "invalid"; // caller shows "paste a YouTube link"
      const meta = await fetchYouTubeMeta(id);
      if (!sessionRef.current?.video_id) {
        // Nothing playing → start immediately.
        await writeSession({
          video_id: meta.videoId,
          title: meta.title,
          thumbnail: meta.thumbnail,
          duration: null,
          added_by: userId,
          is_playing: true,
          position_seconds: 0,
        });
      } else {
        await supabase.from("music_queue").insert({
          channel_id: channelId,
          video_id: meta.videoId,
          title: meta.title,
          thumbnail: meta.thumbnail,
          added_by: userId,
        });
      }
      return null;
    },
    [channelId, userId, writeSession]
  );

  const removeFromQueue = useCallback(async (id: number) => {
    setQueue((q) => q.filter((t) => t.id !== id)); // optimistic; RLS enforces
    await supabase.from("music_queue").delete().eq("id", id);
  }, []);

  const setLocalVolume = useCallback((v: number) => {
    volRef.current = v;
    setLocalVolumeState(v);
    localStorage.setItem("aocom-music-vol", String(v));
    playerRef.current?.setVolume?.(v); // LOCAL only — never written to DB
  }, []);

  /* ── Player + realtime lifecycle ──────────────────────────────────── */
  useEffect(() => {
    if (!channelId) return;
    let disposed = false;
    let container: HTMLDivElement | null = null;

    (async () => {
      await loadYouTubeApi();
      if (disposed) return;
      // Hidden, body-level container so audio survives closing the panel.
      container = document.createElement("div");
      container.style.cssText = "position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;";
      const mount = document.createElement("div");
      container.appendChild(mount);
      document.body.appendChild(container);

      playerRef.current = new (window as any).YT.Player(mount, {
        height: "1",
        width: "1",
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1 },
        events: {
          onReady: () => {
            playerRef.current?.setVolume?.(volRef.current);
            if (sessionRef.current) applySession(sessionRef.current);
          },
          onStateChange: (e: any) => {
            // 0 = ended
            if (e.data !== 0) return;
            const s = sessionRef.current;
            if (!s) return;
            if (s.loop) {
              void writeSession({ position_seconds: 0, is_playing: true });
            } else if (isLeader()) {
              void performNext();
            }
          },
        },
      });
    })();

    // Initial state.
    void (async () => {
      const [{ data: sess }] = await Promise.all([
        supabase.from("room_sessions").select("*").eq("channel_id", channelId).maybeSingle(),
      ]);
      if (!disposed && sess) {
        setSession(sess as RoomSession);
        applySession(sess as RoomSession);
      }
      await refetchQueue();
    })();

    const chan = supabase.channel(`music:${channelId}`, {
      config: { private: true, presence: { key: userId } },
    });
    chanRef.current = chan;

    chan
      .on("presence", { event: "sync" }, () => {
        const keys = Object.keys(chan.presenceState());
        setListeners(Math.max(1, keys.length));
        leaderRef.current = keys.length ? [...keys].sort()[0] : userId;
      })
      .on("broadcast", { event: "skip-vote" }, ({ payload }) => {
        const { from, videoId } = payload as { from: string; videoId: string };
        const set = votesRef.current.get(videoId) ?? new Set<string>();
        set.add(from);
        votesRef.current.set(videoId, set);
        if (sessionRef.current?.video_id === videoId) setSkipVotes(set.size);
        const needed = Math.floor(listeners / 2) + 1;
        if (isLeader() && set.size >= needed) void performNext();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_sessions", filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const s = (payload.new ?? null) as RoomSession | null;
          setSession(s && "channel_id" in s ? s : null);
          applySession(s && "channel_id" in s ? s : null);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "music_queue", filter: `channel_id=eq.${channelId}` },
        () => void refetchQueue()
      )
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await chan.track({ at: Date.now() });
      });

    // Light progress ticker for the UI.
    const tick = setInterval(() => {
      const p = playerRef.current;
      if (p?.getCurrentTime) setPosition(p.getCurrentTime());
    }, 500);

    return () => {
      disposed = true;
      clearInterval(tick);
      try {
        playerRef.current?.destroy?.();
      } catch {}
      playerRef.current = null;
      loadedRef.current = null;
      if (container) container.remove();
      void supabase.removeChannel(chan);
      chanRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, userId]);

  return {
    session,
    queue,
    listeners,
    skipVotes,
    skipNeeded: Math.floor(listeners / 2) + 1,
    position,
    localVolume,
    setLocalVolume,
    addTrack,
    playPause,
    next,
    prev,
    toggleLoop,
    removeFromQueue,
  };
}
