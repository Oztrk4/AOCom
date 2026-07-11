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
  MicIcon,
  MicOffIcon,
  MusicIcon,
  PhoneOffIcon,
  ScreenShareIcon,
  ScreenShareOffIcon,
  VolumeIcon,
} from "@/components/ui/icons";
import type { Channel, VideoQuality } from "@/lib/types";

function Tile({
  id,
  stream,
  isSelf,
  speaking,
  fill = false,
  screen = false,
  setPeerVolume,
}: {
  id: string;
  stream: MediaStream | null;
  isSelf: boolean;
  speaking: boolean;
  /** Theater mode: stretch to the grid cell instead of a fixed ratio. */
  fill?: boolean;
  /** Screen-share tile: fit (don't crop) + "· Ekran" label, no glow. */
  screen?: boolean;
  /** Remote-only: adjust this peer's local playback gain (0-2). */
  setPeerVolume?: (peerId: string, v: number) => void;
}) {
  const profile = useAppStore((s) => s.profiles[id]);
  const peerVol = useAppStore((s) => s.peerVolumes[id] ?? 1);
  const setStorePeerVolume = useAppStore((s) => s.setPeerVolume);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [volOpen, setVolOpen] = useState(false);

  const canAdjust = !isSelf && !screen && !!setPeerVolume;

  const hasVideo =
    stream?.getVideoTracks().some((t) => t.readyState === "live" && !t.muted) ??
    false;

  useEffect(() => {
    const el = videoRef.current;
    if (el && stream && el.srcObject !== stream) el.srcObject = stream;
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
      <button
        onClick={() => canAdjust && setVolOpen((o) => !o)}
        className={`absolute bottom-1.5 left-2 rounded bg-bg-0/70 px-1.5 py-0.5 text-[10px] font-semibold backdrop-blur ${
          canAdjust ? "cursor-pointer hover:bg-bg-0/90" : "cursor-default"
        }`}
        title={canAdjust ? "Ses seviyesini ayarla" : undefined}
      >
        {screen && "🖥️ "}
        {profile?.nickname ?? "…"}
        {isSelf && " (you)"}
        {screen && " · Ekran"}
        {canAdjust && peerVol !== 1 && (
          <span className="ml-1 text-accent">{Math.round(peerVol * 100)}%</span>
        )}
      </button>
      {/* Inline per-user volume slider (local only, 0-200%) */}
      {canAdjust && volOpen && (
        <div className="absolute bottom-7 left-2 right-2 flex items-center gap-2 rounded-lg bg-bg-0/85 px-2 py-1.5 backdrop-blur">
          <VolumeIcon width={12} height={12} className="text-text-1" />
          <input
            type="range"
            min={0}
            max={200}
            value={Math.round(peerVol * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              setStorePeerVolume(id, v);
              setPeerVolume?.(id, v);
            }}
            className="h-1 flex-1 accent-[var(--accent)]"
          />
          <span className="w-8 text-right text-[9px] tabular-nums text-text-1">
            {Math.round(peerVol * 100)}%
          </span>
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
          <span className="text-[10px] text-text-1">{count} connected</span>
          <button
            onClick={() => setTheaterMode(!theaterMode)}
            className={`rounded-md p-1.5 transition-colors ${
              theaterMode
                ? "bg-accent-soft text-accent"
                : "text-text-1 hover:bg-bg-2 hover:text-text-0"
            }`}
            aria-label={theaterMode ? "Exit expanded layout" : "Expand layout"}
            title={theaterMode ? "Back to chat view" : "Expand layout (theater)"}
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
          />
        ))}
        {/* Screen-share tiles (local + remote), shown while sharing */}
        {localScreen && (
          <Tile
            key="screen-self"
            id={userId}
            stream={localScreen}
            isSelf
            speaking={false}
            fill={theaterMode}
            screen
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
            aria-label="Toggle microphone"
          >
            {muted ? <MicOffIcon /> : <MicIcon />}
          </button>
          <button
            onClick={() => setDeafened(!deafened)}
            className={`rounded-full p-2.5 transition-colors ${
              deafened ? "bg-danger text-white" : "bg-bg-2 text-text-0 hover:bg-bg-3"
            }`}
            aria-label="Toggle deafen"
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
            aria-label="Toggle camera"
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
            aria-label="Disconnect"
          >
            <PhoneOffIcon />
          </button>
        </div>
        <div className="flex items-center justify-center gap-2 text-[11px] text-text-1">
          <label htmlFor="quality">Cam quality</label>
          <select
            id="quality"
            value={quality}
            onChange={(e) => setQuality(e.target.value as VideoQuality)}
            className="rounded-md border border-edge bg-bg-2 px-2 py-1 text-xs text-text-0 outline-none focus:border-accent"
          >
            <option value="360p">360p · save FPS</option>
            <option value="480p">480p · balanced</option>
            <option value="720p">720p · crisp</option>
          </select>
        </div>
      </div>
    </div>
  );
}
