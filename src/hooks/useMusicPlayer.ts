"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { loadYouTubeApi, resolveTrack } from "@/lib/youtube";
import type {
  HistoryEntry,
  LoopMode,
  QueueItem,
  RoomSession,
} from "@/lib/types";

const DRIFT_TOLERANCE = 1.5; // seconds before we force a re-seek
const LOOP_ORDER: LoopMode[] = ["none", "track", "queue"];

/**
 * Room-synchronized YouTube music player.
 *
 * Truth is the `room_sessions` row (current track + is_playing + position +
 * loop_mode + history). Upcoming tracks live in `music_queue`, ordered by a
 * float `position` (so shuffle / drag-reorder / re-insert are O(1) writes).
 * Everyone converges to sub-second sync; per-user volume is purely local.
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
  const queueRef = useRef<QueueItem[]>([]);
  const chanRef = useRef<RealtimeChannel | null>(null);
  const leaderRef = useRef<string>(userId);
  const votesRef = useRef<Map<string, Set<string>>>(new Map());
  const volRef = useRef(localVolume);

  sessionRef.current = session;
  const isLeader = () => leaderRef.current === userId;
  const canShuffle = isAdmin || isLeader();

  const setQueueSynced = (list: QueueItem[]) => {
    queueRef.current = list;
    setQueue(list);
  };

  const curEntry = (s: RoomSession): HistoryEntry => ({
    video_id: s.video_id as string,
    title: s.title,
    thumbnail: s.thumbnail,
    duration: s.duration,
    added_by: s.added_by,
  });

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
      votesRef.current.delete(s.video_id);
      setSkipVotes(0);
      if (s.is_playing) player.loadVideoById(s.video_id, pos);
      else player.cueVideoById(s.video_id, pos);
      return;
    }
    const state = player.getPlayerState?.(); // 1 playing, 2 paused
    if (s.is_playing && state !== 1) player.playVideo?.();
    if (!s.is_playing && state === 1) player.pauseVideo?.();
    const cur = player.getCurrentTime?.() ?? 0;
    if (Math.abs(cur - pos) > DRIFT_TOLERANCE) player.seekTo?.(pos, true);
  }, []);

  const writeSession = useCallback(
    async (patch: Partial<RoomSession>) => {
      if (!channelId) return;
      const prev = sessionRef.current;
      const pick = <T,>(a: T | undefined, b: T): T => (a !== undefined ? a : b);
      const row = {
        channel_id: channelId,
        video_id: pick(patch.video_id, prev?.video_id ?? null),
        title: pick(patch.title, prev?.title ?? null),
        thumbnail: pick(patch.thumbnail, prev?.thumbnail ?? null),
        duration: pick(patch.duration, prev?.duration ?? null),
        added_by: pick(patch.added_by, prev?.added_by ?? null),
        is_playing: patch.is_playing ?? prev?.is_playing ?? false,
        loop_mode: patch.loop_mode ?? prev?.loop_mode ?? "none",
        history: patch.history ?? prev?.history ?? [],
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
      .order("position");
    setQueueSynced((data as QueueItem[]) ?? []);
  }, [channelId]);

  const insertQueueRow = useCallback(
    async (t: { video_id: string; title: string; thumbnail: string | null; duration: number | null; added_by: string }) => {
      if (!channelId) return;
      await supabase.from("music_queue").insert({
        channel_id: channelId,
        video_id: t.video_id,
        title: t.title,
        thumbnail: t.thumbnail,
        duration: t.duration,
        added_by: t.added_by,
        position: Date.now() / 1000, // always appends to the end
      });
    },
    [channelId]
  );

  /** Advance to the next track. Honors loop_mode + records history. */
  const performAdvance = useCallback(async () => {
    if (!channelId) return;
    const s = sessionRef.current;
    const { data } = await supabase
      .from("music_queue")
      .select("*")
      .eq("channel_id", channelId)
      .order("position")
      .limit(1);
    const head = (data as QueueItem[])?.[0];
    votesRef.current.clear();
    setSkipVotes(0);
    const mode: LoopMode = s?.loop_mode ?? "none";
    const hist = s?.history ?? [];

    if (head) {
      const newHist = s?.video_id ? [...hist, curEntry(s)].slice(-100) : hist;
      // Loop-queue: the finished track goes back to the end of the queue.
      if (mode === "queue" && s?.video_id) {
        await insertQueueRow({
          video_id: s.video_id,
          title: s.title ?? "",
          thumbnail: s.thumbnail,
          duration: s.duration,
          added_by: s.added_by ?? userId,
        });
      }
      await supabase.from("music_queue").delete().eq("id", head.id);
      await writeSession({
        video_id: head.video_id,
        title: head.title,
        thumbnail: head.thumbnail,
        duration: head.duration,
        added_by: head.added_by,
        is_playing: true,
        position_seconds: 0,
        history: newHist,
      });
    } else if (mode === "queue" && s?.video_id) {
      // Loop-queue with nothing else queued → replay current.
      await writeSession({ position_seconds: 0, is_playing: true });
    } else {
      // End of queue: keep the final track's metadata, just stop.
      await writeSession({ is_playing: false, position_seconds: 0 });
    }
  }, [channelId, userId, writeSession, insertQueueRow]);

  /* ── Controls ─────────────────────────────────────────────────────── */
  const playPause = useCallback(() => {
    const s = sessionRef.current;
    if (!s?.video_id) return;
    const pos = playerRef.current?.getCurrentTime?.() ?? s.position_seconds;
    void writeSession({ is_playing: !s.is_playing, position_seconds: pos });
  }, [writeSession]);

  const cycleLoop = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const next = LOOP_ORDER[(LOOP_ORDER.indexOf(s.loop_mode) + 1) % 3];
    void writeSession({ loop_mode: next });
  }, [writeSession]);

  /** Previous: pop from history, re-insert current at end of queue. */
  const prev = useCallback(async () => {
    const s = sessionRef.current;
    if (!s?.video_id) return;
    const hist = s.history ?? [];
    if (hist.length > 0) {
      const target = hist[hist.length - 1];
      if (s.video_id) {
        await insertQueueRow({
          video_id: s.video_id,
          title: s.title ?? "",
          thumbnail: s.thumbnail,
          duration: s.duration,
          added_by: s.added_by ?? userId,
        });
      }
      await writeSession({
        video_id: target.video_id,
        title: target.title,
        thumbnail: target.thumbnail,
        duration: target.duration,
        added_by: target.added_by,
        is_playing: true,
        position_seconds: 0,
        history: hist.slice(0, -1),
      });
    } else {
      await writeSession({ position_seconds: 0, is_playing: true });
    }
  }, [userId, writeSession, insertQueueRow]);

  const requestSkip = useCallback(() => {
    const s = sessionRef.current;
    if (!s?.video_id) return;
    const set = votesRef.current.get(s.video_id) ?? new Set<string>();
    set.add(userId);
    votesRef.current.set(s.video_id, set);
    setSkipVotes(set.size);
    chanRef.current?.send({
      type: "broadcast",
      event: "skip-vote",
      payload: { from: userId, videoId: s.video_id },
    });
    const needed = Math.floor(listeners / 2) + 1;
    if (isLeader() && set.size >= needed) void performAdvance();
  }, [userId, listeners, performAdvance]);

  const next = useCallback(() => {
    const s = sessionRef.current;
    if (!s?.video_id || queueRef.current.length === 0) return; // disabled on final track
    if (isAdmin || s.added_by === userId) void performAdvance();
    else requestSkip();
  }, [isAdmin, userId, performAdvance, requestSkip]);

  /** Click-to-play: jump straight to a queued track. */
  const playSpecific = useCallback(
    async (item: QueueItem) => {
      const s = sessionRef.current;
      const hist = s?.history ?? [];
      const newHist = s?.video_id ? [...hist, curEntry(s)].slice(-100) : hist;
      await supabase.from("music_queue").delete().eq("id", item.id);
      await writeSession({
        video_id: item.video_id,
        title: item.title,
        thumbnail: item.thumbnail,
        duration: item.duration,
        added_by: item.added_by,
        is_playing: true,
        position_seconds: 0,
        history: newHist,
      });
    },
    [writeSession]
  );

  const addTrack = useCallback(
    async (input: string): Promise<"notfound" | null> => {
      if (!channelId || !input.trim()) return "notfound";
      const meta = await resolveTrack(input);
      if (!meta) return "notfound";
      if (!sessionRef.current?.video_id) {
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
        await insertQueueRow({
          video_id: meta.videoId,
          title: meta.title,
          thumbnail: meta.thumbnail,
          duration: null,
          added_by: userId,
        });
      }
      return null;
    },
    [channelId, userId, writeSession, insertQueueRow]
  );

  const removeFromQueue = useCallback(async (id: number) => {
    setQueueSynced(queueRef.current.filter((t) => t.id !== id));
    await supabase.from("music_queue").delete().eq("id", id);
  }, []);

  /** Admin / leader only: randomly re-order the whole queue. */
  const shuffle = useCallback(async () => {
    if (!channelId || !(isAdmin || isLeader())) return;
    const ids = queueRef.current.map((t) => t.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const base = Date.now() / 1000;
    await Promise.all(
      ids.map((id, idx) =>
        supabase.from("music_queue").update({ position: base + idx }).eq("id", id)
      )
    );
  }, [channelId, isAdmin]);

  /** Drag-reorder: move item from one index to another (fractional pos). */
  const reorderQueue = useCallback(async (from: number, to: number) => {
    const arr = [...queueRef.current];
    if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to)
      return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    setQueueSynced(arr); // optimistic
    const idx = arr.indexOf(moved);
    const before = arr[idx - 1];
    const after = arr[idx + 1];
    let newPos: number;
    if (!before) newPos = (after?.position ?? Date.now() / 1000) - 1;
    else if (!after) newPos = before.position + 1;
    else newPos = (before.position + after.position) / 2;
    await supabase.from("music_queue").update({ position: newPos }).eq("id", moved.id);
  }, []);

  const setLocalVolume = useCallback((v: number) => {
    volRef.current = v;
    setLocalVolumeState(v);
    localStorage.setItem("aocom-music-vol", String(v));
    playerRef.current?.setVolume?.(v);
  }, []);

  /* ── Player + realtime lifecycle ──────────────────────────────────── */
  useEffect(() => {
    if (!channelId) return;
    let disposed = false;
    let container: HTMLDivElement | null = null;

    (async () => {
      await loadYouTubeApi();
      if (disposed) return;
      container = document.createElement("div");
      container.style.cssText =
        "position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;";
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
            if (e.data !== 0) return; // 0 = ended
            if (!isLeader()) return; // only the leader drives transitions
            const s = sessionRef.current;
            if (!s?.video_id) return;
            if (s.loop_mode === "track") {
              void writeSession({ position_seconds: 0, is_playing: true });
            } else {
              void performAdvance();
            }
          },
        },
      });
    })();

    void (async () => {
      const { data: sess } = await supabase
        .from("room_sessions")
        .select("*")
        .eq("channel_id", channelId)
        .maybeSingle();
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
        if (isLeader() && set.size >= needed) void performAdvance();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_sessions", filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const s = (payload.new ?? null) as RoomSession | null;
          const val = s && "channel_id" in s ? s : null;
          setSession(val);
          applySession(val);
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
    canNext: queue.length > 0,
    canShuffle,
    setLocalVolume,
    addTrack,
    playPause,
    next,
    prev,
    cycleLoop,
    shuffle,
    playSpecific,
    reorderQueue,
    removeFromQueue,
  };
}
