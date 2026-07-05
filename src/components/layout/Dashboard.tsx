"use client";
import { useCallback, useEffect } from "react";
import { useAppStore } from "@/stores/app-store";
import { useBootstrap } from "@/hooks/useBootstrap";
import { usePresence } from "@/hooks/usePresence";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useRing } from "@/hooks/useRing";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { usePushToTalk } from "@/hooks/usePushToTalk";
import { Titlebar } from "./Titlebar";
import { Sidebar } from "./Sidebar";
import { ChatArea } from "@/components/chat/ChatArea";
import { FriendsList } from "./FriendsList";
import { VoiceGrid } from "@/components/voice/VoiceGrid";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { Avatar } from "@/components/ui/Avatar";
import {
  MicOffIcon,
  PhoneIcon,
  PhoneOffIcon,
  XIcon,
} from "@/components/ui/icons";
import { requestMicAccess } from "@/lib/media";
import { isAdminEmail, type Channel } from "@/lib/types";

export function Dashboard({
  userId,
  userEmail,
  signOut,
}: {
  userId: string;
  userEmail: string | null;
  signOut: () => Promise<void>;
}) {
  useBootstrap(userId);
  usePresence(userId);
  useGlobalShortcuts();
  usePushToTalk();

  const rtc = useWebRTC(userId);
  const voiceChannel = useAppStore((s) => s.voiceChannel);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const incomingRing = useAppStore((s) => s.incomingRing);
  const micError = useAppStore((s) => s.micError);
  const theaterMode = useAppStore((s) => s.theaterMode);
  const muted = useAppStore((s) => s.muted);
  const deafened = useAppStore((s) => s.deafened);
  const camOn = useAppStore((s) => s.camOn);
  const quality = useAppStore((s) => s.quality);
  const inputMode = useAppStore((s) => s.inputMode);
  const pttActive = useAppStore((s) => s.pttActive);

  const joinVoice = useCallback(
    async (channel: Channel) => {
      const state = useAppStore.getState();
      if (state.voiceChannel?.id === channel.id) return;
      if (state.voiceChannel) await rtc.leave();
      state.setCamOn(false);
      state.setVoiceChannel(channel);
      const ok = await rtc.join(channel.id);
      // Mic blocked/unavailable: roll back cleanly, the banner explains why.
      if (!ok) useAppStore.getState().setVoiceChannel(null);
    },
    [rtc]
  );

  const leaveVoice = useCallback(async () => {
    await rtc.leave();
    const state = useAppStore.getState();
    state.setVoiceChannel(null);
    state.setCamOn(false);
    state.setTheaterMode(false);
  }, [rtc]);

  const acceptCall = useCallback(
    (channelId: string) => {
      const ch = useAppStore
        .getState()
        .channels.find((c) => c.id === channelId && c.type === "voice");
      if (ch) void joinVoice(ch);
    },
    [joinVoice]
  );

  const { sendRing, respondToRing } = useRing(userId, acceptCall);

  // Wire mute/deafen/PTT/camera/quality state into the live WebRTC session.
  // In PTT mode the track is hard-disabled until the key is held: zero
  // packets leave the machine, so peripherals are dead silent.
  useEffect(() => {
    rtc.setMicEnabled(
      !muted && !deafened && (inputMode === "voice" || pttActive)
    );
  }, [muted, deafened, inputMode, pttActive, rtc]);

  useEffect(() => {
    if (rtc.connected) void rtc.setCamera(camOn, quality);
  }, [camOn, rtc]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void rtc.applyQuality(quality);
  }, [quality, rtc]);

  return (
    <div className="flex h-screen flex-col bg-bg-0">
      <Titlebar />

      {/* Mic permission recovery banner */}
      {micError && (
        <div className="flex shrink-0 items-center gap-3 border-b border-danger/30 bg-danger/10 px-4 py-2">
          <MicOffIcon width={15} height={15} className="shrink-0 text-danger" />
          <p className="min-w-0 flex-1 truncate text-xs text-text-0/90">
            {micError}
          </p>
          <button
            onClick={async () => {
              const err = await requestMicAccess();
              useAppStore.getState().setMicError(err);
            }}
            className="shrink-0 rounded-md bg-accent px-3 py-1 text-[11px] font-bold text-bg-0 transition-opacity hover:opacity-90"
          >
            Re-request access
          </button>
          <button
            onClick={() => window.location.reload()}
            className="shrink-0 rounded-md border border-edge px-3 py-1 text-[11px] font-semibold text-text-1 transition-colors hover:text-text-0"
          >
            Reload app
          </button>
          <button
            onClick={() => useAppStore.getState().setMicError(null)}
            className="shrink-0 rounded p-1 text-text-1 hover:text-text-0"
            aria-label="Dismiss"
          >
            <XIcon width={13} height={13} />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <Sidebar
          joinVoice={joinVoice}
          leaveVoice={leaveVoice}
          speakingIds={rtc.speakingIds}
          isAdmin={isAdminEmail(userEmail)}
        />
        {/* Theater mode: chat collapses, the room grid takes the width */}
        {!(theaterMode && voiceChannel) && <ChatArea userId={userId} />}
        <aside
          className={`flex min-h-0 flex-col border-l border-edge bg-bg-1 ${
            theaterMode && voiceChannel ? "min-w-0 flex-1" : "w-80 shrink-0"
          }`}
        >
          {voiceChannel ? (
            <VoiceGrid
              userId={userId}
              channel={voiceChannel}
              localStream={rtc.localStream}
              remoteStreams={rtc.remoteStreams}
              speakingIds={rtc.speakingIds}
              leaveVoice={leaveVoice}
            />
          ) : (
            <FriendsList userId={userId} sendRing={sendRing} />
          )}
        </aside>
      </div>

      {settingsOpen && (
        <SettingsModal signOut={signOut} setMicDevice={rtc.setMicDevice} />
      )}

      {/* In-app ring banner (popup window covers the minimized case) */}
      {incomingRing && (
        <div className="absolute right-4 top-12 z-50 flex items-center gap-3 rounded-2xl border border-edge bg-bg-1 p-3 shadow-2xl">
          <div className="relative">
            <div className="ripple absolute inset-0 rounded-full" />
            <Avatar
              nickname={incomingRing.fromNick}
              avatarUrl={incomingRing.avatarUrl}
              size={44}
            />
          </div>
          <div>
            <p className="text-sm font-bold">{incomingRing.fromNick}</p>
            <p className="text-xs text-text-1">
              is calling · {incomingRing.channelName}
            </p>
          </div>
          <button
            onClick={() => respondToRing(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-success text-bg-0 hover:scale-110"
            aria-label="Accept call"
          >
            <PhoneIcon width={16} height={16} />
          </button>
          <button
            onClick={() => respondToRing(false)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-danger text-white hover:scale-110"
            aria-label="Decline call"
          >
            <PhoneOffIcon width={16} height={16} />
          </button>
        </div>
      )}
    </div>
  );
}
