"use client";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useMusicPlayer } from "@/hooks/useMusicPlayer";
import { MusicPanel } from "@/components/music/MusicPanel";
import { Avatar } from "@/components/ui/Avatar";
import {
  CamIcon,
  CamOffIcon,
  CollapseIcon,
  ExpandIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MaximizeIcon,
  MicIcon,
  MicOffIcon,
  MinimizeIcon,
  MusicIcon,
  PhoneOffIcon,
  ScreenShareIcon,
  ScreenShareOffIcon,
  VolumeIcon,
} from "@/components/ui/icons";
import { gainToUi, uiToGain } from "@/lib/volume";
import type { Channel, VideoQuality } from "@/lib/types";

function Tile({
  id,
  stream,
  isSelf,
  speaking,
  fill = false,
  screen = false,
  setPeerVolume,
  onMaximize,
  maximized = false,
  isAdmin = false,
  onKick,
}: {
  id: string;
  stream: MediaStream | null;
  isSelf: boolean;
  speaking: boolean;
  /** Theater mode: stretch to the grid cell instead of a fixed ratio. */
  fill?: boolean;
  /** Screen-share tile: fit (don't crop) + "· Ekran" label, no glow. */
  screen?: boolean;
  /** Remote-only: adjust this peer's local playback gain (0-4). */
  setPeerVolume?: (peerId: string, v: number) => void;
  /** Screen-only: toggle the synced full-column maximize overlay. */
  onMaximize?: () => void;
  maximized?: boolean;
  /** Admin: enables the "Kanaldan At" action in the tile popover. */
  isAdmin?: boolean;
  onKick?: (peerId: string) => void;
}) {
  const profile = useAppStore((s) => s.profiles[id]);
  const peerVol = useAppStore((s) => s.peerVolumes[id] ?? 1);
  const setStorePeerVolume = useAppStore((s) => s.setPeerVolume);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [volOpen, setVolOpen] = useState(false);

  const canAdjust = !isSelf && !screen && !!setPeerVolume;
  const canKick = isAdmin && !isSelf && !screen && !!onKick;
  const canExpand = canAdjust || canKick;

  // Show the <video> whenever a non-ended video track exists. We deliberately
  // do NOT require `!muted`: a freshly received remote track (camera OR
  // screen) reports muted:true until its first frame decodes, and the local
  // camera track is always live — gating on muted left the element hidden and
  // the tile blank even while frames were flowing.
  const hasVideo =
    stream?.getVideoTracks().some((t) => t.readyState !== "ended") ?? false;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    // Explicitly (re)start playback and swallow the benign AbortError raised
    // when srcObject swaps mid-play. Relying on the autoPlay attribute alone
    // occasionally leaves the element paused after a track swap → the camera
    // light is on but the tile stays black.
    const kick = () => void el.play().catch(() => {});
    kick();
    el.onloadedmetadata = kick;
    return () => {
      el.onloadedmetadata = null;
    };
  }, [stream]);

  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-bg-2 ${
        fill ? "h-full min-h-[180px]" : "aspect-video"
      } ${screen ? "border-accent/60" : "border-edge"} ${speaking ? "speaking" : ""}`}
    >
      {/* Audio flows through the Web Audio engine, so the element is muted. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={
          hasVideo
            ? `h-full w-full ${screen ? "bg-black object-contain" : "object-cover"}`
            : "hidden"
        }
      />
      {!hasVideo && (
        <div className="flex h-full items-center justify-center">
          <Avatar
            nickname={profile?.nickname ?? "?"}
            avatarUrl={profile?.avatar_url}
            size={fill ? 96 : 56}
            className={speaking ? "ring-2 ring-accent" : ""}
          />
        </div>
      )}
      {/* Screen-tile maximize (synced to all watchers) */}
      {screen && onMaximize && (
        <button
          onClick={onMaximize}
          className="absolute right-1.5 top-1.5 rounded-md bg-bg-0/70 p-1 text-text-0 backdrop-blur transition-colors hover:bg-accent hover:text-bg-0"
          title={maximized ? "Küçült" : "Büyüt"}
          aria-label={maximized ? "Küçült" : "Büyüt"}
        >
          {maximized ? (
            <MinimizeIcon width={13} height={13} />
          ) : (
            <MaximizeIcon width={13} height={13} />
          )}
        </button>
      )}
      <button
        onClick={() => canExpand && setVolOpen((o) => !o)}
        className={`absolute bottom-1.5 left-2 rounded bg-bg-0/70 px-1.5 py-0.5 text-[10px] font-semibold backdrop-blur ${
          canExpand ? "cursor-pointer hover:bg-bg-0/90" : "cursor-default"
        }`}
        title={
          canAdjust
            ? "Ses seviyesini ayarla"
            : canKick
              ? "Yönetici işlemleri"
              : undefined
        }
      >
        {screen && "🖥️ "}
        {profile?.nickname ?? "…"}
        {isSelf && " (sen)"}
        {screen && " · Ekran"}
        {canAdjust && peerVol !== 1 && (
          <span className="ml-1 text-accent">{gainToUi(peerVol)}</span>
        )}
      </button>
      {/* Inline popover: per-user volume (0-100 UI → 0-4.0 gain) + admin kick */}
      {canExpand && volOpen && (
        <div className="absolute bottom-7 left-2 right-2 space-y-1.5 rounded-lg bg-bg-0/85 px-2 py-1.5 backdrop-blur">
          {canAdjust && (
            <div className="flex items-center gap-2">
              <VolumeIcon width={12} height={12} className="text-text-1" />
              <input
                type="range"
                min={0}
                max={100}
                value={gainToUi(peerVol)}
                onChange={(e) => {
                  const v = uiToGain(Number(e.target.value));
                  setStorePeerVolume(id, v);
                  setPeerVolume?.(id, v);
                }}
                className="h-1 flex-1 accent-[var(--accent)]"
              />
              <span className="w-8 text-right text-[9px] tabular-nums text-text-1">
                {gainToUi(peerVol)}
              </span>
            </div>
          )}
          {canKick && (
            <button
              onClick={() => {
                setVolOpen(false);
                onKick?.(id);
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-danger/40 px-2 py-1 text-[10px] font-semibold text-danger transition-colors hover:bg-danger hover:text-white"
            >
              <PhoneOffIcon width={11} height={11} />
              Kanaldan At
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function VoiceGrid({
  userId,
  channel,
  isAdmin = false,
  localStream,
  remoteStreams,
  localScreen,
  remoteScreens,
  speakingIds,
  leaveVoice,
  startScreenShare,
  stopScreenShare,
  setPeerVolume,
  toggleMaximize,
  maximizedScreen,
  kickFromChannel,
}: {
  userId: string;
  channel: Channel;
  isAdmin?: boolean;
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  localScreen: MediaStream | null;
  remoteScreens: Record<string, MediaStream>;
  speakingIds: Set<string>;
  leaveVoice: () => Promise<void>;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => Promise<void>;
  setPeerVolume: (peerId: string, v: number) => void;
  toggleMaximize: (target: string) => void;
  maximizedScreen: string | null;
  kickFromChannel: (targetId: string) => Promise<void>;
}) {
  const {
    muted,
    deafened,
    camOn,
    quality,
    theaterMode,
    inputMode,
    pttActive,
    setMuted,
    setDeafened,
    setCamOn,
    setQuality,
    setTheaterMode,
  } = useAppStore();

  // Room music player (persists while in the voice channel).
  const music = useMusicPlayer(channel.id, userId, isAdmin);
  const [musicOpen, setMusicOpen] = useState(false);

  // PTT: the self tile glows while transmitting (key held) — instant
  // "am I live?" feedback. Voice activity mode keeps analyser-driven glow.
  const selfSpeaking =
    inputMode === "ptt"
      ? pttActive && !muted && !deafened
      : !muted && speakingIds.has(userId);

  // Smart theater grid: 1 → full-width, 2 → split, 3 → two up + one wide,
  // 4 → 2x2 quadrant, 5+ → 3-wide mosaic.
  const count = Object.keys(remoteStreams).length + 1;
  const theaterGridCls =
    count <= 1
      ? "grid-cols-1"
      : count === 2
        ? "grid-cols-2"
        : count === 3
          ? "grid-cols-2 [&>*:last-child]:col-span-2"
          : count === 4
            ? "grid-cols-2"
            : "grid-cols-3";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {musicOpen && (
        <MusicPanel
          music={music}
          userId={userId}
          isAdmin={isAdmin}
          onClose={() => setMusicOpen(false)}
        />
      )}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-edge px-4">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-accent">
          🔊 {channel.name}
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-text-1">{count} bağlı</span>
          <button
            onClick={() => setTheaterMode(!theaterMode)}
            className={`rounded-md p-1.5 transition-colors ${
              theaterMode
                ? "bg-accent-soft text-accent"
                : "text-text-1 hover:bg-bg-2 hover:text-text-0"
            }`}
            aria-label={theaterMode ? "Geniş görünümden çık" : "Geniş görünüm"}
            title={theaterMode ? "Sohbet görünümüne dön" : "Geniş görünüm (tiyatro)"}
          >
            {theaterMode ? (
              <CollapseIcon width={15} height={15} />
            ) : (
              <ExpandIcon width={15} height={15} />
            )}
          </button>
        </div>
      </div>

      {/* Peer grid */}
      <div
        className={
          theaterMode
            ? `grid min-h-0 flex-1 auto-rows-fr gap-3 overflow-y-auto p-4 ${theaterGridCls}`
            : "grid flex-1 auto-rows-min grid-cols-1 gap-2 overflow-y-auto p-3"
        }
      >
        <Tile
          id={userId}
          stream={localStream}
          isSelf
          speaking={selfSpeaking}
          fill={theaterMode}
        />
        {Object.entries(remoteStreams).map(([peerId, stream]) => (
          <Tile
            key={peerId}
            id={peerId}
            stream={stream}
            isSelf={false}
            speaking={speakingIds.has(peerId)}
            fill={theaterMode}
            setPeerVolume={setPeerVolume}
            isAdmin={isAdmin}
            onKick={kickFromChannel}
          />
        ))}
        {/* Screen-share tiles (local + remote) — a dedicated box, never
            replacing the sharer's camera/avatar card */}
        {localScreen && (
          <Tile
            key="screen-self"
            id={userId}
            stream={localScreen}
            isSelf
            speaking={false}
            fill={theaterMode}
            screen
            onMaximize={() => toggleMaximize(userId)}
            maximized={maximizedScreen === userId}
          />
        )}
        {Object.entries(remoteScreens).map(([peerId, stream]) => (
          <Tile
            key={`screen-${peerId}`}
            id={peerId}
            stream={stream}
            isSelf={false}
            speaking={false}
            fill={theaterMode}
            screen
            onMaximize={() => toggleMaximize(peerId)}
            maximized={maximizedScreen === peerId}
          />
        ))}
      </div>

      {/* Controls */}
      <div className="shrink-0 space-y-2 border-t border-edge p-3">
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setMuted(!muted)}
            className={`rounded-full p-2.5 transition-colors ${
              muted ? "bg-danger text-white" : "bg-bg-2 text-text-0 hover:bg-bg-3"
            }`}
            aria-label="Mikrofonu aç/kapat"
          >
            {muted ? <MicOffIcon /> : <MicIcon />}
          </button>
          <button
            onClick={() => setDeafened(!deafened)}
            className={`rounded-full p-2.5 transition-colors ${
              deafened ? "bg-danger text-white" : "bg-bg-2 text-text-0 hover:bg-bg-3"
            }`}
            aria-label="Sesi aç/kapat"
          >
            {deafened ? <HeadphonesOffIcon /> : <HeadphonesIcon />}
          </button>
          <button
            onClick={() => setCamOn(!camOn)}
            className={`rounded-full p-2.5 transition-colors ${
              camOn
                ? "bg-accent text-bg-0"
                : "bg-bg-2 text-text-0 hover:bg-bg-3"
            }`}
            aria-label="Kamerayı aç/kapat"
          >
            {camOn ? <CamIcon /> : <CamOffIcon />}
          </button>
          <button
            onClick={() => (localScreen ? stopScreenShare() : startScreenShare())}
            className={`rounded-full p-2.5 transition-colors ${
              localScreen
                ? "bg-accent text-bg-0"
                : "bg-bg-2 text-text-0 hover:bg-bg-3"
            }`}
            aria-label="Ekranı Paylaş"
            title={localScreen ? "Paylaşımı durdur" : "Ekranı Paylaş"}
          >
            {localScreen ? <ScreenShareIcon /> : <ScreenShareOffIcon />}
          </button>
          <button
            onClick={() => setMusicOpen((o) => !o)}
            className={`rounded-full p-2.5 transition-colors ${
              musicOpen || music.session?.is_playing
                ? "bg-accent/80 text-bg-0"
                : "bg-bg-2 text-text-0 hover:bg-bg-3"
            }`}
            aria-label="Müzik"
            title="Müzik"
          >
            <MusicIcon />
          </button>
          <button
            onClick={() => leaveVoice()}
            className="rounded-full bg-danger p-2.5 text-white transition-transform hover:scale-105"
            aria-label="Bağlantıyı kes"
          >
            <PhoneOffIcon />
          </button>
        </div>
        <div className="flex items-center justify-center gap-2 text-[11px] text-text-1">
          <label htmlFor="quality">Kamera kalitesi</label>
          <select
            id="quality"
            value={quality}
            onChange={(e) => setQuality(e.target.value as VideoQuality)}
            className="rounded-md border border-edge bg-bg-2 px-2 py-1 text-xs text-text-0 outline-none focus:border-accent"
          >
            <option value="360p">360p · FPS koru</option>
            <option value="480p">480p · dengeli</option>
            <option value="720p">720p · net</option>
          </select>
        </div>
      </div>
    </div>
  );
}
