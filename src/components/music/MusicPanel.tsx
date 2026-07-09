"use client";
import { useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useMusicPlayer } from "@/hooks/useMusicPlayer";
import { formatDuration } from "@/lib/youtube";
import {
  GripIcon,
  PauseIcon,
  PlayIcon,
  Repeat1Icon,
  RepeatIcon,
  ShuffleIcon,
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
    canNext,
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
  } = music;

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const submit = async () => {
    if (!input.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const res = await addTrack(input);
    setBusy(false);
    if (res === "notfound") setErr("Sonuç bulunamadı — bir YouTube linki dene.");
    else setInput("");
  };

  const playing = session?.is_playing ?? false;
  const dur = session?.duration ?? 0;
  const pct = dur > 0 ? Math.min(100, (position / dur) * 100) : 0;
  const loopMode = session?.loop_mode ?? "none";
  const willVote = !isAdmin && session?.added_by !== userId;
  const nick = (id: string | null | undefined) =>
    (id && profiles[id]?.nickname) || "Bilinmeyen";

  const loopTitle =
    loopMode === "track"
      ? "Şarkıyı tekrarla"
      : loopMode === "queue"
        ? "Sırayı tekrarla"
        : "Tekrar kapalı";

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-bg-1/95 backdrop-blur-md">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-edge px-4">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-accent">
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

      {/* Search (URL or free text) */}
      <div className="shrink-0 p-3">
        <div className="flex items-center gap-2 rounded-xl border border-edge bg-bg-2 px-3 py-1.5 focus-within:border-accent">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Şarkı adı ara veya YouTube linki yapıştır…"
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
              {session.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
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
                  {!playing && !canNext && (
                    <span className="ml-1 text-[10px] text-text-1">(bitti)</span>
                  )}
                </p>
                <p className="truncate text-[11px] text-text-1">
                  Ekleyen: {nick(session.added_by)}
                </p>
              </div>
            </div>
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
                onClick={() => shuffle()}
                disabled={!canShuffle || queue.length < 2}
                className="rounded-full bg-bg-2 p-2 text-text-1 transition-colors hover:bg-bg-3 hover:text-text-0 disabled:opacity-30"
                aria-label="Karıştır"
                title={canShuffle ? "Karıştır" : "Sadece admin / lider"}
              >
                <ShuffleIcon width={15} height={15} />
              </button>
              <button
                onClick={prev}
                className="rounded-full bg-bg-2 p-2 text-text-0 hover:bg-bg-3"
                aria-label="Önceki"
                title="Önceki"
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
                disabled={!canNext}
                className="rounded-full bg-bg-2 p-2 text-text-0 hover:bg-bg-3 disabled:opacity-30"
                aria-label="Sonraki"
                title={!canNext ? "Son şarkı" : willVote ? "Atlamak için oy ver" : "Sonraki"}
              >
                <SkipForwardIcon width={16} height={16} />
              </button>
              <button
                onClick={cycleLoop}
                className={`rounded-full p-2 transition-colors ${
                  loopMode !== "none"
                    ? "bg-accent-soft text-accent"
                    : "bg-bg-2 text-text-1 hover:bg-bg-3"
                }`}
                aria-label="Döngü"
                title={loopTitle}
              >
                {loopMode === "track" ? (
                  <Repeat1Icon width={16} height={16} />
                ) : (
                  <RepeatIcon width={16} height={16} />
                )}
              </button>
            </div>
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

      {/* Queue — click to play, drag to reorder */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <p className="px-1 pb-1 text-[10px] font-bold uppercase tracking-widest text-text-1">
          Sıradaki ({queue.length})
        </p>
        {queue.length === 0 ? (
          <p className="p-3 text-center text-[11px] text-text-1">Sıra boş.</p>
        ) : (
          <ul className="space-y-1">
            {queue.map((t, idx) => {
              const canDelete = t.added_by === userId || isAdmin;
              return (
                <li
                  key={t.id}
                  draggable
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIdx !== null && dragIdx !== idx) reorderQueue(dragIdx, idx);
                    setDragIdx(null);
                  }}
                  onDragEnd={() => setDragIdx(null)}
                  className={`group flex items-center gap-2 rounded-lg p-1.5 transition-colors hover:bg-bg-2 ${
                    dragIdx === idx ? "opacity-50" : ""
                  }`}
                >
                  <span className="shrink-0 cursor-grab text-text-1/60" title="Sürükle">
                    <GripIcon width={13} height={13} />
                  </span>
                  <button
                    onClick={() => playSpecific(t)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title="Bu şarkıyı çal"
                  >
                    {t.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.thumbnail}
                        alt=""
                        className="h-8 w-12 shrink-0 rounded object-cover"
                        draggable={false}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-text-0">{t.title}</span>
                      <span className="block truncate text-[10px] text-text-1">
                        {nick(t.added_by)}
                      </span>
                    </span>
                  </button>
                  {canDelete && (
                    <button
                      onClick={() => removeFromQueue(t.id)}
                      className="shrink-0 rounded p-1 text-text-1 opacity-0 hover:text-danger group-hover:opacity-100"
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
