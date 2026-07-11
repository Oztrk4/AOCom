"use client";
import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useBootstrap } from "@/hooks/useBootstrap";
import { usePresence } from "@/hooks/usePresence";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useRing } from "@/hooks/useRing";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { usePushToTalk } from "@/hooks/usePushToTalk";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { playJoinChime, playLeaveChime } from "@/lib/sounds";
import { AdminPanel } from "@/components/admin/AdminPanel";
import { DragDropUpload } from "@/components/chat/DragDropUpload";
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
  useHeartbeat(userId);

  const rtc = useWebRTC(userId);
  const voiceChannel = useAppStore((s) => s.voiceChannel);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const incomingRing = useAppStore((s) => s.incomingRing);
  const micError = useAppStore((s) => s.micError);
  const theaterMode = useAppStore((s) => s.theaterMode);
  const adminOpen = useAppStore((s) => s.adminOpen);
  const muted = useAppStore((s) => s.muted);
  const deafened = useAppStore((s) => s.deafened);
  const camOn = useAppStore((s) => s.camOn);
  const quality = useAppStore((s) => s.quality);
  const inputMode = useAppStore((s) => s.inputMode);
  const pttActive = useAppStore((s) => s.pttActive);
  const micLevel = useAppStore((s) => s.micLevel);
  const masterVolume = useAppStore((s) => s.masterVolume);
  const speakerDeviceId = useAppStore((s) => s.speakerDeviceId);
  const [voiceBanOpen, setVoiceBanOpen] = useState(false);

  const joinVoice = useCallback(
    async (channel: Channel) => {
      const state = useAppStore.getState();
      // Ses banı: block joining voice entirely and explain why.
      if (state.profile?.has_voice_ban) {
        setVoiceBanOpen(true);
        return;
      }
      if (state.voiceChannel?.id === channel.id) return;
      if (state.voiceChannel) await rtc.leave();
      state.setCamOn(false);
      state.setVoiceChannel(channel);
      const ok = await rtc.join(channel.id);
      // Mic blocked/unavailable: roll back cleanly, the banner explains why.
      if (!ok) useAppStore.getState().setVoiceChannel(null);
      else playJoinChime(); // local-only "landing" chime
    },
    [rtc]
  );

  const leaveVoice = useCallback(async () => {
    playLeaveChime(); // local-only "leave" chime
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

  // Live audio-engine gains: outgoing mic level, incoming master (0 when
  // deafened), and the output device sink.
  useEffect(() => {
    rtc.applyMicLevel(micLevel);
  }, [micLevel, rtc]);
  useEffect(() => {
    rtc.applyMasterVolume(deafened ? 0 : masterVolume);
  }, [masterVolume, deafened, rtc]);
  useEffect(() => {
    void rtc.applyOutputSink(speakerDeviceId);
  }, [speakerDeviceId, rtc]);

  useEffect(() => {
    if (rtc.connected) void rtc.setCamera(camOn, quality);
  }, [camOn, rtc]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void rtc.applyQuality(quality);
  }, [quality, rtc]);

  return (
    <div className="flex h-screen flex-col bg-bg-0">
      <Titlebar />
      <DragDropUpload userId={userId} />

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
        {!(theaterMode && voiceChannel) && (
          <ChatArea userId={userId} isAdmin={isAdminEmail(userEmail)} />
        )}
        <aside
          className={`flex min-h-0 flex-col border-l border-edge bg-bg-1 ${
            theaterMode && voiceChannel ? "min-w-0 flex-1" : "w-80 shrink-0"
          }`}
        >
          {voiceChannel ? (
            <VoiceGrid
              userId={userId}
              channel={voiceChannel}
              isAdmin={isAdminEmail(userEmail)}
              localStream={rtc.localStream}
              remoteStreams={rtc.remoteStreams}
              localScreen={rtc.localScreen}
              remoteScreens={rtc.remoteScreens}
              speakingIds={rtc.speakingIds}
              leaveVoice={leaveVoice}
              startScreenShare={rtc.startScreenShare}
              stopScreenShare={rtc.stopScreenShare}
              setPeerVolume={rtc.setPeerVolume}
            />
          ) : (
            <FriendsList
              userId={userId}
              sendRing={sendRing}
              isAdmin={isAdminEmail(userEmail)}
            />
          )}
        </aside>
      </div>

      {settingsOpen && (
        <SettingsModal
          signOut={signOut}
          setMicDevice={rtc.setMicDevice}
          isAdmin={isAdminEmail(userEmail)}
        />
      )}

      {adminOpen && isAdminEmail(userEmail) && <AdminPanel userId={userId} />}

      {/* Voice-ban notice when a banned user tries to join a voice room */}
      {voiceBanOpen && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center bg-bg-0/80 backdrop-blur-sm"
          onClick={() => setVoiceBanOpen(false)}
        >
          <div
            className="w-[380px] max-w-[90vw] rounded-2xl border border-edge bg-bg-1 p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 text-4xl">🔇</div>
            <p className="mb-4 text-sm font-semibold text-text-0">
              Ses banı nedeniyle ses odalarına katılamazsınız.
            </p>
            <button
              onClick={() => setVoiceBanOpen(false)}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-bg-0"
            >
              Tamam
            </button>
          </div>
        </div>
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
