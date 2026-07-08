"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/app-store";
import { Avatar } from "@/components/ui/Avatar";
import { XIcon } from "@/components/ui/icons";

/**
 * Admin context menu for a single user: toggle chat / voice / app bans.
 * Every write is also enforced by the "admin manages profiles" RLS policy,
 * so only the admin account can actually flip these flags.
 */
export function AdminUserMenu({
  targetId,
  onClose,
}: {
  targetId: string;
  onClose: () => void;
}) {
  const profile = useAppStore((s) => s.profiles[targetId]);
  const upsertProfile = useAppStore((s) => s.upsertProfile);
  const [busy, setBusy] = useState<string | null>(null);

  if (!profile) return null;

  const chatBan = profile.has_chat_ban ?? false;
  const voiceBan = profile.has_voice_ban ?? false;
  const appBanned = profile.is_active === false;

  const set = async (field: "has_chat_ban" | "has_voice_ban" | "is_active", value: boolean) => {
    setBusy(field);
    const { error } = await supabase
      .from("profiles")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", targetId);
    if (!error) upsertProfile({ ...profile, [field]: value });
    setBusy(null);
  };

  const row = (
    label: string,
    active: boolean,
    onClick: () => void,
    field: string
  ) => (
    <button
      onClick={onClick}
      disabled={busy === field}
      className={`w-full rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition-colors disabled:opacity-50 ${
        active
          ? "border-danger/40 bg-danger/10 text-danger hover:bg-danger hover:text-white"
          : "border-edge bg-bg-2 text-text-0 hover:border-accent"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-bg-0/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[340px] max-w-[90vw] rounded-2xl border border-edge bg-bg-1 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <Avatar nickname={profile.nickname} avatarUrl={profile.avatar_url} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{profile.nickname}</p>
            <p className="text-[10px] text-text-1">Yönetici işlemleri</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-1 hover:bg-bg-2 hover:text-text-0"
            aria-label="Kapat"
          >
            <XIcon width={15} height={15} />
          </button>
        </div>

        <div className="space-y-2">
          {row(
            chatBan ? "Sohbet Banını Kaldır" : "Sohbet Banı At",
            chatBan,
            () => set("has_chat_ban", !chatBan),
            "has_chat_ban"
          )}
          {row(
            voiceBan ? "Ses Banını Kaldır" : "Ses Banı At",
            voiceBan,
            () => set("has_voice_ban", !voiceBan),
            "has_voice_ban"
          )}
          {row(
            appBanned ? "Uygulama Banını Kaldır" : "Uygulama Banı At",
            appBanned,
            () => set("is_active", appBanned),
            "is_active"
          )}
        </div>
      </div>
    </div>
  );
}
