"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { nativeConfirm } from "@/lib/tauri";
import { useAppStore } from "@/stores/app-store";
import { Avatar } from "@/components/ui/Avatar";
import {
  CheckIcon,
  GearIcon,
  HashIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  PencilIcon,
  PlusIcon,
  ShieldIcon,
  SpeakerIcon,
  TrashIcon,
  VolumeIcon,
  XIcon,
} from "@/components/ui/icons";
import { APP_VERSION } from "@/lib/version";
import type { Channel, ChannelType } from "@/lib/types";

export function Sidebar({
  joinVoice,
  leaveVoice,
  speakingIds,
  isAdmin,
  setPeerVolume,
}: {
  joinVoice: (c: Channel) => Promise<void>;
  leaveVoice: () => Promise<void>;
  speakingIds: Set<string>;
  isAdmin: boolean;
  setPeerVolume: (peerId: string, v: number) => void;
}) {
  const {
    profile,
    profiles,
    channels,
    activeTextChannel,
    voiceChannel,
    statuses,
    onlineIds,
    muted,
    deafened,
    setActiveTextChannel,
    setMuted,
    setDeafened,
    setSettingsOpen,
    setAdminOpen,
  } = useAppStore();

  // Admin CRUD state (buttons render only for the admin; RLS is the guard)
  const [adding, setAdding] = useState<ChannelType | null>(null);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  // Per-user volume slider open state + values (local playback gain).
  const [volFor, setVolFor] = useState<string | null>(null);
  const peerVolumes = useAppStore((s) => s.peerVolumes);
  const setStorePeerVolume = useAppStore((s) => s.setPeerVolume);

  const createChannel = async () => {
    const name = newName.trim();
    if (!name || !adding) return;
    await supabase.from("channels").insert({ name, type: adding });
    setAdding(null);
    setNewName("");
  };

  const renameChannel = async (id: string) => {
    const name = editName.trim();
    if (name) await supabase.from("channels").update({ name }).eq("id", id);
    setEditingId(null);
  };

  const deleteChannel = async (c: Channel) => {
    const ok = await nativeConfirm(
      "Delete channel",
      `Delete “${c.name}”? ${
        c.type === "text" ? "All its messages are removed too." : ""
      }`
    );
    if (!ok) return;
    if (voiceChannel?.id === c.id) await leaveVoice();
    await supabase.from("channels").delete().eq("id", c.id);
  };

  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");

  const membersOf = (channelId: string) =>
    Object.values(statuses)
      .filter((s) => s.current_voice_channel === channelId)
      .map((s) => profiles[s.user_id])
      .filter(Boolean);

  const sectionHeader = (label: string, type: ChannelType) => (
    <div className="mb-1 flex items-center justify-between px-1">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-1">
        {label}
      </h3>
      {isAdmin && (
        <button
          onClick={() => {
            setAdding(adding === type ? null : type);
            setNewName("");
          }}
          className="rounded p-0.5 text-text-1 transition-colors hover:bg-bg-2 hover:text-accent"
          aria-label={`Create ${type} channel`}
          title={`Create ${type} channel`}
        >
          <PlusIcon width={13} height={13} />
        </button>
      )}
    </div>
  );

  const addForm = (type: ChannelType) =>
    adding === type && (
      <div className="mb-1 flex items-center gap-1 px-1">
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void createChannel();
            if (e.key === "Escape") setAdding(null);
          }}
          placeholder={type === "text" ? "new-channel" : "New Room"}
          maxLength={32}
          className="min-w-0 flex-1 rounded-md border border-edge bg-bg-2 px-2 py-1 text-xs outline-none focus:border-accent select-text"
        />
        <button
          onClick={createChannel}
          className="rounded p-1 text-success hover:bg-bg-2"
          aria-label="Confirm create"
        >
          <CheckIcon width={13} height={13} />
        </button>
        <button
          onClick={() => setAdding(null)}
          className="rounded p-1 text-text-1 hover:bg-bg-2"
          aria-label="Cancel create"
        >
          <XIcon width={13} height={13} />
        </button>
      </div>
    );

  const adminRowActions = (c: Channel) =>
    isAdmin &&
    editingId !== c.id && (
      <span className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setEditingId(c.id);
            setEditName(c.name);
          }}
          className="rounded p-1 text-text-1 hover:text-accent"
          aria-label={`Rename ${c.name}`}
        >
          <PencilIcon width={11} height={11} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            void deleteChannel(c);
          }}
          className="rounded p-1 text-text-1 hover:text-danger"
          aria-label={`Delete ${c.name}`}
        >
          <TrashIcon width={11} height={11} />
        </button>
      </span>
    );

  const editForm = (c: Channel) => (
    <div className="flex flex-1 items-center gap-1">
      <input
        autoFocus
        value={editName}
        onChange={(e) => setEditName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void renameChannel(c.id);
          if (e.key === "Escape") setEditingId(null);
        }}
        maxLength={32}
        className="min-w-0 flex-1 rounded-md border border-accent bg-bg-2 px-2 py-0.5 text-xs outline-none select-text"
      />
      <button
        onClick={() => renameChannel(c.id)}
        className="rounded p-1 text-success hover:bg-bg-2"
        aria-label="Confirm rename"
      >
        <CheckIcon width={12} height={12} />
      </button>
    </div>
  );

  return (
    <nav className="flex w-60 shrink-0 flex-col border-r border-edge bg-bg-1">
      {/* Branding */}
      <div className="flex h-12 items-center border-b border-edge px-4">
        <span
          className="text-lg font-black tracking-tight"
          style={{
            background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          AOCom
        </span>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-3">
        {/* Text channels */}
        <section>
          {sectionHeader("Text Channels", "text")}
          {addForm("text")}
          {textChannels.map((c) => (
            <div
              key={c.id}
              className={`group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                activeTextChannel?.id === c.id
                  ? "bg-accent-soft text-text-0"
                  : "text-text-1 hover:bg-bg-2 hover:text-text-0"
              }`}
              onClick={() => editingId !== c.id && setActiveTextChannel(c)}
            >
              <HashIcon width={15} height={15} className="shrink-0 opacity-70" />
              {editingId === c.id ? (
                editForm(c)
              ) : (
                <span className="truncate">{c.name}</span>
              )}
              {adminRowActions(c)}
            </div>
          ))}
        </section>

        {/* Voice channels */}
        <section>
          {sectionHeader("Voice Channels", "voice")}
          {addForm("voice")}
          {voiceChannels.map((c) => {
            const members = membersOf(c.id);
            const joined = voiceChannel?.id === c.id;
            return (
              <div key={c.id}>
                <div
                  className={`group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                    joined
                      ? "bg-accent-soft text-accent"
                      : "text-text-1 hover:bg-bg-2 hover:text-text-0"
                  }`}
                  onClick={() =>
                    editingId !== c.id && (joined ? leaveVoice() : joinVoice(c))
                  }
                >
                  <SpeakerIcon width={15} height={15} className="shrink-0 opacity-70" />
                  {editingId === c.id ? (
                    editForm(c)
                  ) : (
                    <span className="truncate">{c.name}</span>
                  )}
                  {adminRowActions(c)}
                  {members.length > 0 && editingId !== c.id && (
                    <span className="ml-auto text-[10px] text-text-1 group-hover:hidden">
                      {members.length}
                    </span>
                  )}
                </div>
                {members.length > 0 && (
                  <ul className="mb-1 ml-6 space-y-0.5">
                    {members.map((m) => {
                      const talking = speakingIds.has(m.id);
                      // Adjustable only for other members in the room I'm in.
                      const canAdjust =
                        voiceChannel?.id === c.id && m.id !== profile?.id;
                      const vol = peerVolumes[m.id] ?? 1;
                      return (
                        <li key={m.id} className="text-xs text-text-1">
                          <div
                            onClick={() =>
                              canAdjust &&
                              setVolFor((v) => (v === m.id ? null : m.id))
                            }
                            className={`flex items-center gap-2 py-0.5 ${
                              canAdjust ? "cursor-pointer hover:text-text-0" : ""
                            }`}
                            title={canAdjust ? "Ses seviyesini ayarla" : undefined}
                          >
                            {/* Real-time speaking glow in the theme accent */}
                            <span className={`rounded-full ${talking ? "speaking" : ""}`}>
                              <Avatar
                                nickname={m.nickname}
                                avatarUrl={m.avatar_url}
                                size={18}
                              />
                            </span>
                            <span
                              className={`truncate ${
                                talking ? "font-semibold text-accent" : ""
                              }`}
                            >
                              {m.nickname}
                            </span>
                            {canAdjust && vol !== 1 && (
                              <span className="text-[9px] text-accent">
                                {Math.round(vol * 100)}%
                              </span>
                            )}
                            {onlineIds.has(m.id) && (
                              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-success" />
                            )}
                          </div>
                          {canAdjust && volFor === m.id && (
                            <div className="flex items-center gap-1 py-1 pl-6">
                              <VolumeIcon width={11} height={11} className="text-text-1" />
                              <input
                                type="range"
                                min={0}
                                max={400}
                                value={Math.round(vol * 100)}
                                onChange={(e) => {
                                  const v = Number(e.target.value) / 100;
                                  setStorePeerVolume(m.id, v);
                                  setPeerVolume(m.id, v);
                                }}
                                className="h-1 flex-1 accent-[var(--accent)]"
                              />
                              <span className="w-7 text-right text-[9px] tabular-nums text-text-1">
                                {Math.round(vol * 100)}%
                              </span>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      </div>

      {/* User profile card */}
      <div className="flex items-center gap-2 border-t border-edge bg-bg-0/50 p-2.5">
        <Avatar
          nickname={profile?.nickname ?? "?"}
          avatarUrl={profile?.avatar_url}
          size={32}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{profile?.nickname}</p>
          <p className="text-[10px] text-success">
            {voiceChannel ? `Voice · ${voiceChannel.name}` : "Online"}
          </p>
        </div>
        <button
          onClick={() => setMuted(!muted)}
          className={`rounded p-1.5 transition-colors hover:bg-bg-2 ${
            muted ? "text-danger" : "text-text-1"
          }`}
          aria-label="Toggle mute"
        >
          {muted ? <MicOffIcon width={15} height={15} /> : <MicIcon width={15} height={15} />}
        </button>
        <button
          onClick={() => setDeafened(!deafened)}
          className={`rounded p-1.5 transition-colors hover:bg-bg-2 ${
            deafened ? "text-danger" : "text-text-1"
          }`}
          aria-label="Toggle deafen"
        >
          {deafened ? (
            <HeadphonesOffIcon width={15} height={15} />
          ) : (
            <HeadphonesIcon width={15} height={15} />
          )}
        </button>
        {isAdmin && (
          <button
            onClick={() => setAdminOpen(true)}
            className="rounded p-1.5 text-text-1 transition-colors hover:bg-bg-2 hover:text-accent"
            aria-label="Admin panel"
            title="Admin Panel"
          >
            <ShieldIcon width={15} height={15} />
          </button>
        )}
        <button
          onClick={() => setSettingsOpen(true)}
          className="rounded p-1.5 text-text-1 transition-colors hover:bg-bg-2 hover:text-text-0"
          aria-label="Settings"
        >
          <GearIcon width={15} height={15} />
        </button>
      </div>

      {/* App version — low-contrast, unobtrusive */}
      <div className="border-t border-edge bg-bg-0/50 px-3 py-1 text-right">
        <span className="text-[9px] tracking-wide text-text-1/50">
          v{APP_VERSION}
        </span>
      </div>
    </nav>
  );
}
