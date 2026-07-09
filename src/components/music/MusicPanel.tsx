"use client";
import { useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useMusicPlayer } from "@/hooks/useMusicPlayer";
import { formatDuration } from "@/lib/youtube";
import {
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  SkipBackIcon,
  SkipForwardIcon,
  TrashIcon,
  VolumeIcon,
  XIcon,
} from "@/components/ui/icons";

type Music = ReturnType<typeof useMusicPlayer>;

export function MusicPanel({
  music,
  userId,
  isAdmin,
  onClose,
}: {
  music: Music;
  userId: string;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const profiles = useAppStore((s) => s.profiles);
  const {
    session,
    queue,
    listeners,
    skipVotes,
    skipNeeded,
    position,
    localVolume,
    setLocalVolume,
    addTrack,
    playPause,
    next,
    prev,
    toggleLoop,
    removeFromQueue,
  } = music;

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!input.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const res = await addTrack(input);
    setBusy(false);
    if (res === "invalid") {
      setErr("Bir YouTube linki veya video ID'si yapıştır.");
    } else {
      setInput("");
    }
  };

  const playing = session?.is_playing ?? false;
  const dur = session?.duration ?? 0;
  const pct = dur > 0 ? Math.min(100, (position / dur) * 100) : 0;
  // Non-admins who don't own the current track will trigger a vote on "next".
  const willVote = !isAdmin && session?.added_by !== userId;
  const nick = (id: string | null | undefined) =>
    (id && profiles[id]?.nickname) || "Bilinmeyen";

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-bg-1/95 backdrop-blur-md">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-edge px-4">
        <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-accent">
          🎵 Müzik · {listeners} dinleyici
        </h3>
        <button
          onClick={onClose}
          className="rounded p-1 text-text-1 hover:bg-bg-2 hover:text-text-0"
          aria-label="Kapat"
        >
          <XIcon width={15} height={15} />
        </button>
      </div>

      {/* Search */}
      <div className="shrink-0 p-3">
        <div className="flex items-center gap-2 rounded-xl border border-edge bg-bg-2 px-3 py-1.5 focus-within:border-accent">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="YouTube linki / video ID yapıştır…"
            className="flex-1 bg-transparent py-1 text-sm outline-none placeholder-text-1 select-text"
          />
          <button
            onClick={submit}
            disabled={busy || !input.trim()}
            className="rounded-md bg-accent px-3 py-1 text-[11px] font-bold text-bg-0 disabled:opacity-40"
          >
            {busy ? "…" : "Ekle"}
          </button>
        </div>
        {err && <p className="mt-1 text-[10px] text-danger">{err}</p>}
      </div>

      {/* Now playing */}
      <div className="shrink-0 border-y border-edge bg-bg-0/40 p-3">
        {session?.video_id ? (
          <>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {session.thumbnail && (
                <img
                  src={session.thumbnail}
                  alt=""
                  className="h-12 w-20 shrink-0 rounded-md object-cover"
                  draggable={false}
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-text-0">
                  {session.title ?? session.video_id}
                </p>
                <p className="truncate text-[11px] text-text-1">
                  Ekleyen: {nick(session.added_by)}
                </p>
              </div>
            </div>
            {/* Progress */}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px] tabular-nums text-text-1">
                {formatDuration(position)}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-3">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: "linear-gradient(90deg, var(--accent), var(--accent-2))",
                  }}
                />
              </div>
              <span className="text-[10px] tabular-nums text-text-1">
                {formatDuration(dur)}
              </span>
            </div>
            {/* Controls */}
            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                onClick={prev}
                className="rounded-full bg-bg-2 p-2 text-text-0 hover:bg-bg-3"
                aria-label="Baştan"
                title="Baştan başlat"
              >
                <SkipBackIcon width={16} height={16} />
              </button>
              <button
                onClick={playPause}
                className="rounded-full bg-accent p-2.5 text-bg-0 hover:opacity-90"
                aria-label={playing ? "Duraklat" : "Oynat"}
              >
                {playing ? <PauseIcon width={18} height={18} /> : <PlayIcon width={18} height={18} />}
              </button>
              <button
                onClick={next}
                className="relative rounded-full bg-bg-2 p-2 text-text-0 hover:bg-bg-3"
                aria-label="Sonraki"
                title={willVote ? "Atlamak için oy ver" : "Sonraki"}
              >
                <SkipForwardIcon width={16} height={16} />
              </button>
              <button
                onClick={toggleLoop}
                className={`rounded-full p-2 transition-colors ${
                  session.loop ? "bg-accent-soft text-accent" : "bg-bg-2 text-text-1 hover:bg-bg-3"
                }`}
                aria-label="Tekrarla"
                title="Tekrarla"
              >
                <RepeatIcon width={16} height={16} />
              </button>
            </div>
            {/* Vote-skip indicator */}
            {skipVotes > 0 && (
              <p className="mt-2 text-center text-[10px] font-semibold text-accent">
                Atlama oyu: {skipVotes}/{skipNeeded}
              </p>
            )}
          </>
        ) : (
          <p className="py-3 text-center text-xs text-text-1">
            Şu an çalan bir şey yok. Bir şarkı ekle!
          </p>
        )}

        {/* Per-user local volume (never affects other listeners) */}
        <div className="mt-3 flex items-center gap-2">
          <VolumeIcon width={14} height={14} className="text-text-1" />
          <input
            type="range"
            min={0}
            max={100}
            value={localVolume}
            onChange={(e) => setLocalVolume(Number(e.target.value))}
            className="h-1 flex-1 accent-[var(--accent)]"
            aria-label="Ses (yalnızca sizde)"
          />
          <span className="w-8 text-right text-[10px] tabular-nums text-text-1">
            {localVolume}%
          </span>
        </div>
      </div>

      {/* Queue */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <p className="px-1 pb-1 text-[10px] font-bold uppercase tracking-widest text-text-1">
          Sıradaki ({queue.length})
        </p>
        {queue.length === 0 ? (
          <p className="p-3 text-center text-[11px] text-text-1">Sıra boş.</p>
        ) : (
          <ul className="space-y-1">
            {queue.map((t) => {
              const canDelete = t.added_by === userId || isAdmin;
              return (
                <li
                  key={t.id}
                  className="group flex items-center gap-2 rounded-lg p-1.5 hover:bg-bg-2"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {t.thumbnail && (
                    <img
                      src={t.thumbnail}
                      alt=""
                      className="h-8 w-12 shrink-0 rounded object-cover"
                      draggable={false}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-text-0">{t.title}</p>
                    <p className="truncate text-[10px] text-text-1">{nick(t.added_by)}</p>
                  </div>
                  {canDelete && (
                    <button
                      onClick={() => removeFromQueue(t.id)}
                      className="rounded p-1 text-text-1 opacity-0 hover:text-danger group-hover:opacity-100"
                      aria-label="Sıradan kaldır"
                    >
                      <TrashIcon width={13} height={13} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
