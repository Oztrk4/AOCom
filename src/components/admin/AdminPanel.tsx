"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/app-store";
import { Avatar } from "@/components/ui/Avatar";
import { ShieldIcon, XIcon } from "@/components/ui/icons";
import { formatLastSeen } from "@/lib/time";
import type { Profile } from "@/lib/types";

/**
 * Admin-only management panel. Rendering is gated by isAdminEmail in the
 * Dashboard, and every mutation here is additionally enforced by the
 * "admin manages profiles" / "admin updates settings" RLS policies —
 * a non-admin calling these queries gets rejected by Postgres.
 */
export function AdminPanel({ userId }: { userId: string }) {
  const { profiles, onlineIds, setAdminOpen, upsertProfile } = useAppStore();
  const [regOpen, setRegOpen] = useState<boolean | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("system_settings")
      .select("is_registration_open")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => setRegOpen(data?.is_registration_open ?? true));
  }, []);

  const toggleRegistration = async () => {
    if (regOpen === null) return;
    const next = !regOpen;
    setRegOpen(next);
    const { error } = await supabase
      .from("system_settings")
      .update({ is_registration_open: next, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) setRegOpen(!next); // revert on failure
  };

  const toggleUser = async (p: Profile) => {
    const next = !(p.is_active ?? true);
    setBusyId(p.id);
    const { error } = await supabase
      .from("profiles")
      .update({ is_active: next, updated_at: new Date().toISOString() })
      .eq("id", p.id);
    if (!error) upsertProfile({ ...p, is_active: next });
    setBusyId(null);
  };

  const users = Object.values(profiles).sort((a, b) => {
    const ao = onlineIds.has(a.id) ? 0 : 1;
    const bo = onlineIds.has(b.id) ? 0 : 1;
    return ao - bo || a.nickname.localeCompare(b.nickname);
  });

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-bg-0/80 backdrop-blur-sm"
      onClick={() => setAdminOpen(false)}
    >
      <div
        className="flex max-h-[85vh] w-[560px] max-w-[92vw] flex-col rounded-2xl border border-edge bg-bg-1 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <ShieldIcon width={18} height={18} className="text-accent" />
            Admin Panel
          </h2>
          <button
            onClick={() => setAdminOpen(false)}
            className="rounded p-1 text-text-1 hover:bg-bg-2 hover:text-text-0"
            aria-label="Yönetici panelini kapat"
          >
            <XIcon />
          </button>
        </div>

        {/* Registration gate */}
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-text-1">
          Kayıt Kontrolü
        </h3>
        <div className="mb-6 flex items-center justify-between rounded-xl border border-edge bg-bg-2 p-3">
          <div>
            <p className="text-sm font-semibold">
              Yeni kayıtlar:{" "}
              <span className={regOpen ? "text-success" : "text-danger"}>
                {regOpen === null ? "…" : regOpen ? "Açık" : "Kapalı"}
              </span>
            </p>
            <p className="text-[11px] text-text-1">
              Kapalıyken yeni üyelik denemeleri engellenir; mevcut üyeler
              giriş yapmaya devam eder.
            </p>
          </div>
          <button
            onClick={toggleRegistration}
            disabled={regOpen === null}
            role="switch"
            aria-checked={regOpen ?? false}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              regOpen ? "bg-success" : "bg-bg-3"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-text-0 transition-all ${
                regOpen ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </div>

        {/* User management */}
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-text-1">
          Üyeler — {users.length}
        </h3>
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {users.map((u) => {
            const online = onlineIds.has(u.id);
            const active = u.is_active ?? true;
            const isSelf = u.id === userId;
            return (
              <li
                key={u.id}
                className={`flex items-center gap-3 rounded-xl border border-edge p-2.5 ${
                  active ? "bg-bg-2" : "bg-bg-2 opacity-60"
                }`}
              >
                <div className="relative">
                  <Avatar nickname={u.nickname} avatarUrl={u.avatar_url} size={34} />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg-2 ${
                      online ? "bg-success" : "bg-text-1/40"
                    }`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {u.nickname}
                    {isSelf && (
                      <span className="ml-1 text-[10px] text-accent">(admin)</span>
                    )}
                  </p>
                  <p className="truncate text-[11px] text-text-1">
                    {online ? "Şu an çevrimiçi" : formatLastSeen(u.last_seen_at)}
                  </p>
                </div>
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                    active
                      ? "bg-success/15 text-success"
                      : "bg-danger/15 text-danger"
                  }`}
                >
                  {active ? "Aktif" : "Pasif"}
                </span>
                <button
                  onClick={() => toggleUser(u)}
                  disabled={isSelf || busyId === u.id}
                  className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    active
                      ? "border border-danger/40 text-danger hover:bg-danger hover:text-white"
                      : "border border-success/40 text-success hover:bg-success hover:text-bg-0"
                  }`}
                >
                  {busyId === u.id ? "…" : active ? "Pasifleştir" : "Aktifleştir"}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
