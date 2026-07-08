"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/app-store";
import { Avatar } from "@/components/ui/Avatar";
import { XIcon } from "@/components/ui/icons";
import { formatLastSeen } from "@/lib/time";
import type { Profile } from "@/lib/types";

/**
 * Admin-only list of banned (passive) users with a per-row Unban action.
 * The unban UPDATE is additionally enforced by the "admin manages profiles"
 * RLS policy, so only the admin account can actually flip is_active.
 */
export function BannedUsersModal({ onClose }: { onClose: () => void }) {
  const upsertProfile = useAppStore((s) => s.upsertProfile);
  const [banned, setBanned] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("is_active", false)
      .order("nickname");
    setBanned((data as Profile[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const unban = async (p: Profile) => {
    setBusyId(p.id);
    const { error } = await supabase
      .from("profiles")
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq("id", p.id);
    if (!error) {
      upsertProfile({ ...p, is_active: true });
      setBanned((prev) => prev.filter((b) => b.id !== p.id));
    }
    setBusyId(null);
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-bg-0/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-[480px] max-w-[92vw] flex-col rounded-2xl border border-edge bg-bg-1 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Engellenmiş Kişiler</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-1 hover:bg-bg-2 hover:text-text-0"
            aria-label="Kapat"
          >
            <XIcon />
          </button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-xs text-text-1">Yükleniyor…</p>
        ) : banned.length === 0 ? (
          <p className="py-8 text-center text-xs text-text-1">
            Engellenmiş kullanıcı yok.
          </p>
        ) : (
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {banned.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 rounded-xl border border-edge bg-bg-2 p-2.5 opacity-80"
              >
                <Avatar nickname={u.nickname} avatarUrl={u.avatar_url} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{u.nickname}</p>
                  <p className="truncate text-[11px] text-text-1">
                    {formatLastSeen(u.last_seen_at)}
                  </p>
                </div>
                <span className="rounded-md bg-danger/15 px-2 py-0.5 text-[10px] font-bold text-danger">
                  Pasif
                </span>
                <button
                  onClick={() => unban(u)}
                  disabled={busyId === u.id}
                  className="rounded-lg border border-success/40 px-3 py-1.5 text-[11px] font-bold text-success transition-colors hover:bg-success hover:text-bg-0 disabled:opacity-40"
                >
                  {busyId === u.id ? "…" : "Engeli Kaldır"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
