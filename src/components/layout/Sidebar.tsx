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
  PhoneOffIcon,
  PlusIcon,
  ShieldIcon,
  SpeakerIcon,
  TrashIcon,
  VolumeIcon,
  XIcon,
} from "@/components/ui/icons";
import { APP_VERSION } from "@/lib/version";
import { gainToUi, uiToGain } from "@/lib/volume";
import type { Channel, ChannelType } from "@/lib/types";

export function Sidebar({
  joinVoice,
  leaveVoice,
  speakingIds,
  isAdmin,
  setPeerVolume,
  kickFromChannel,
}: {
  joinVoice: (c: Channel) => Promise<void>;
  leaveVoice: () => Promise<void>;
  speakingIds: Set<string>;
  isAdmin: boolean;
  setPeerVolume: (peerId: string, v: number) => void;
  kickFromChannel: (targetId: string) => Promise<void>;
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
      "Kanalı sil",
      `“${c.name}” silinsin mi? ${
        c.type === "text" ? "Tüm mesajları da silinir." : ""
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
          aria-label={`${type === "text" ? "Metin" : "Ses"} kanalı oluştur`}
          title={`${type === "text" ? "Metin" : "Ses"} kanalı oluştur`}
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
          placeholder={type === "text" ? "yeni-kanal" : "Yeni Oda"}
          maxLength={32}
          className="min-w-0 flex-1 rounded-md border border-edge bg-bg-2 px-2 py-1 text-xs outline-none focus:border-accent select-text"
        />
        <button
          onClick={createChannel}
          className="rounded p-1 text-success hover:bg-bg-2"
          aria-label="Oluşturmayı onayla"
        >
          <CheckIcon width={13} height={13} />
        </button>
        <button
          onClick={() => setAdding(null)}
          className="rounded p-1 text-text-1 hover:bg-bg-2"
          aria-label="İptal"
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
          aria-label={`${c.name} yeniden adlandır`}
        >
          <PencilIcon width={11} height={11} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            void deleteChannel(c);
          }}
          className="rounded p-1 text-text-1 hover:text-danger"
          aria-label={`${c.name} sil`}
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
        aria-label="Yeniden adlandırmayı onayla"
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
          {sectionHeader("Metin Kanalları", "text")}
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
          {sectionHeader("Ses Kanalları", "voice")}
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
                      const isSelf = m.id === profile?.id;
                      // Adjustable only for other members in the room I'm in.
                      const canAdjust = voiceChannel?.id === c.id && !isSelf;
                      // Admin may eject anyone (in any room) but themselves.
                      const canKick = isAdmin && !isSelf;
                      const expandable = canAdjust || canKick;
                      const vol = peerVolumes[m.id] ?? 1;
                      return (
                        <li key={m.id} className="text-xs text-text-1">
                          <div
                            onClick={() =>
                              expandable &&
                              setVolFor((v) => (v === m.id ? null : m.id))
                            }
                            className={`flex items-center gap-2 py-0.5 ${
                              expandable ? "cursor-pointer hover:text-text-0" : ""
                            }`}
                            title={
                              canAdjust
                                ? "Ses seviyesini ayarla"
                                : canKick
                                  ? "Yönetici işlemleri"
                                  : undefined
                            }
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
                                {gainToUi(vol)}
                              </span>
                            )}
                            {onlineIds.has(m.id) && (
                              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-success" />
                            )}
                          </div>
                          {expandable && volFor === m.id && (
                            <div className="space-y-1 py-1 pl-6">
                              {canAdjust && (
                                <div className="flex items-center gap-1">
                                  <VolumeIcon
                                    width={11}
                                    height={11}
                                    className="text-text-1"
                                  />
                                  <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    value={gainToUi(vol)}
                                    onChange={(e) => {
                                      const v = uiToGain(Number(e.target.value));
                                      setStorePeerVolume(m.id, v);
                                      setPeerVolume(m.id, v);
                                    }}
                                    className="h-1 flex-1 accent-[var(--accent)]"
                                  />
                                  <span className="w-7 text-right text-[9px] tabular-nums text-text-1">
                                    {gainToUi(vol)}
                                  </span>
                                </div>
                              )}
                              {canKick && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setVolFor(null);
                                    void kickFromChannel(m.id);
                                  }}
                                  className="flex w-full items-center gap-1.5 rounded-md border border-danger/40 px-2 py-1 text-[10px] font-semibold text-danger transition-colors hover:bg-danger hover:text-white"
                                >
                                  <PhoneOffIcon width={11} height={11} />
                                  Kanaldan At
                                </button>
                              )}
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
            {voiceChannel ? `Ses · ${voiceChannel.name}` : "Çevrimiçi"}
          </p>
        </div>
        <button
          onClick={() => setMuted(!muted)}
          className={`rounded p-1.5 transition-colors hover:bg-bg-2 ${
            muted ? "text-danger" : "text-text-1"
          }`}
          aria-label="Mikrofonu aç/kapat"
        >
          {muted ? <MicOffIcon width={15} height={15} /> : <MicIcon width={15} height={15} />}
        </button>
        <button
          onClick={() => setDeafened(!deafened)}
          className={`rounded p-1.5 transition-colors hover:bg-bg-2 ${
            deafened ? "text-danger" : "text-text-1"
          }`}
          aria-label="Sesi aç/kapat"
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
            aria-label="Yönetici paneli"
            title="Yönetici Paneli"
          >
            <ShieldIcon width={15} height={15} />
          </button>
        )}
        <button
          onClick={() => setSettingsOpen(true)}
          className="rounded p-1.5 text-text-1 transition-colors hover:bg-bg-2 hover:text-text-0"
          aria-label="Ayarlar"
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
