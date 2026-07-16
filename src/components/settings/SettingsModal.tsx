"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/app-store";
import { Avatar } from "@/components/ui/Avatar";
import { MicIcon, TrashIcon, XIcon } from "@/components/ui/icons";
import { resetMediaPipeline } from "@/lib/media";
import { processAvatar } from "@/lib/image";
import { gainToUi, uiToGain } from "@/lib/volume";
import { nativeDialog } from "@/lib/tauri";
import { MicTest } from "./MicTest";
import { PttSettings } from "./PttSettings";
import { BannedUsersModal } from "./BannedUsersModal";
import type { ThemeName } from "@/lib/types";

const THEMES: { id: ThemeName; label: string; desc: string; swatch: string[] }[] = [
  { id: "nordic",     label: "Nordic Mat",       desc: "Kömür · arduvaz mavisi",   swatch: ["#1e222a", "#81a1c1", "#88c0d0"] },
  { id: "graphite",   label: "Grafit",           desc: "Endüstriyel · kül beyazı", swatch: ["#181818", "#d4d4d0", "#2a2a2a"] },
  { id: "mutedcyber", label: "Sönük Cyber",      desc: "Kadife · düz mor",         swatch: ["#0d0e15", "#9d8cd6", "#6d7fb8"] },
  { id: "tactical",   label: "Taktik Zümrüt",    desc: "Zeytin · askeri yeşil",    swatch: ["#1c1e1d", "#7a9464", "#a3a86b"] },
];

const selectCls =
  "w-full rounded-lg border border-edge bg-bg-3 px-2.5 py-2 text-xs text-text-0 " +
  "outline-none transition-colors focus:border-accent";

export function SettingsModal({
  signOut,
  setMicDevice,
  isAdmin = false,
}: {
  signOut: () => Promise<void>;
  setMicDevice: (deviceId: string | null) => Promise<void>;
  isAdmin?: boolean;
}) {
  const {
    profile,
    theme,
    micDeviceId,
    speakerDeviceId,
    setTheme,
    setSettingsOpen,
    setProfile,
    setMicDeviceId,
    setSpeakerDeviceId,
    micLevel,
    masterVolume,
    setMicLevel,
    setMasterVolume,
  } = useAppStore();

  const [nickname, setNickname] = useState(profile?.nickname ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [micStatus, setMicStatus] = useState<"idle" | "checking" | "granted" | "blocked">("idle");
  const [micInputs, setMicInputs] = useState<string[]>([]);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [bannedOpen, setBannedOpen] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  /* ── Dynamic device enumeration (live via devicechange) ─────────── */
  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputs(devices.filter((d) => d.kind === "audioinput" && d.deviceId));
      setOutputs(devices.filter((d) => d.kind === "audiooutput" && d.deviceId));
    } catch {
      /* enumeration unavailable — selects fall back to system default */
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () =>
      navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  const onInputChange = (id: string) => {
    const deviceId = id || null;
    setMicDeviceId(deviceId);
    // Hot-swap the live WebRTC capture if a call is running.
    void setMicDevice(deviceId);
  };

  const onOutputChange = (id: string) => {
    // Voice tiles + mic test react via the store (setSinkId per element).
    setSpeakerDeviceId(id || null);
  };

  /* ── Permission reset ───────────────────────────────────────────── */
  const resetMediaPermissions = async () => {
    setMicStatus("checking");
    const result = await resetMediaPipeline();
    useAppStore.getState().setMicError(result.error);
    setMicInputs(result.inputs);
    setMicStatus(result.ok ? "granted" : "blocked");
    await refreshDevices(); // labels populate once permission is live
    if (!result.ok) {
      await nativeDialog(
        "Mikrofon hâlâ kullanılamıyor",
        `${result.error}\n\n` +
          "Nasıl düzeltilir:\n" +
          "1. Windows Ayarları → Gizlilik ve güvenlik → Mikrofon'u aç.\n" +
          "2. “Mikrofon erişimi” ve “Masaüstü uygulamalarının mikrofona erişmesine izin ver”i AÇ.\n" +
          "3. Bir mikrofonun takılı ve Ses ayarlarında devre dışı olmadığından emin ol.\n" +
          "4. Geri dönüp tekrar “Medya İzinlerini Sıfırla”ya bas — yeniden kurulum gerekmez.",
        "warning"
      );
    }
  };

  /* ── Avatar upload: crop → 128px WebP → Supabase Storage ────────── */
  const onAvatarFile = async (file: File | null) => {
    if (!file || !profile) return;
    setAvatarBusy(true);
    try {
      const blob = await processAvatar(file);
      const path = `avatars/${profile.id}/${Date.now()}.webp`;
      const { error: upErr } = await supabase.storage
        .from("attachments")
        .upload(path, blob, { contentType: "image/webp" });
      if (upErr) throw upErr;
      const url = supabase.storage.from("attachments").getPublicUrl(path)
        .data.publicUrl;
      const patch = { avatar_url: url, updated_at: new Date().toISOString() };
      const { error: dbErr } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", profile.id);
      if (dbErr) throw dbErr;
      setProfile({ ...profile, ...patch });
    } catch {
      await nativeDialog(
        "Avatar yüklenemedi",
        "Görsel işlenemedi veya yüklenemedi. PNG/JPEG kullan ve bağlantını kontrol et.",
        "error"
      );
    } finally {
      setAvatarBusy(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  /* ── Remove avatar: clear the DB field + delete the stored file ───── */
  const removeAvatar = async () => {
    if (!profile || !profile.avatar_url) return;
    setAvatarBusy(true);
    try {
      const marker = "/object/public/attachments/";
      const idx = profile.avatar_url.indexOf(marker);
      if (idx >= 0) {
        const path = profile.avatar_url.slice(idx + marker.length);
        await supabase.storage.from("attachments").remove([path]).catch(() => {});
      }
      const patch = { avatar_url: null, updated_at: new Date().toISOString() };
      const { error } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", profile.id);
      if (error) throw error;
      setProfile({ ...profile, avatar_url: null });
    } catch {
      await nativeDialog("Hata", "Profil resmi kaldırılamadı.", "error");
    } finally {
      setAvatarBusy(false);
    }
  };

  const saveProfile = async () => {
    if (!profile) return;
    setSaving(true);
    const patch = {
      nickname: nickname.trim() || profile.nickname,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", profile.id);
    if (!error) {
      setProfile({ ...profile, ...patch });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
    setSaving(false);
  };

  const deviceLabel = (d: MediaDeviceInfo, i: number, kind: string) =>
    d.label || `${kind} ${i + 1}`;

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-bg-0/80 backdrop-blur-sm"
      onClick={() => setSettingsOpen(false)}
    >
      <div
        className="max-h-[88vh] w-[560px] max-w-[92vw] overflow-y-auto rounded-2xl border border-edge bg-bg-1 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold">Ayarlar</h2>
          <button
            onClick={() => setSettingsOpen(false)}
            className="rounded p-1 text-text-1 hover:bg-bg-2 hover:text-text-0"
            aria-label="Ayarları kapat"
          >
            <XIcon />
          </button>
        </div>

        {/* Theme engine */}
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-text-1">
          Tema
        </h3>
        <div className="mb-6 grid grid-cols-4 gap-2">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                theme === t.id
                  ? "border-accent bg-accent-soft"
                  : "border-edge bg-bg-2 hover:border-text-1"
              }`}
            >
              <div className="mb-2 flex gap-1">
                {t.swatch.map((c) => (
                  <span
                    key={c}
                    className="h-4 w-4 rounded-full border border-white/10"
                    style={{ background: c }}
                  />
                ))}
              </div>
              <p className="text-xs font-bold">{t.label}</p>
              <p className="text-[10px] text-text-1">{t.desc}</p>
            </button>
          ))}
        </div>

        {/* Voice & Media */}
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-text-1">
          Ses ve Medya
        </h3>
        <div className="mb-6 space-y-3 rounded-xl border border-edge bg-bg-2 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-semibold text-text-1">
                Ses Girişi (Mikrofon)
              </label>
              <select
                value={micDeviceId ?? ""}
                onChange={(e) => onInputChange(e.target.value)}
                className={selectCls}
              >
                <option value="">Sistem varsayılanı</option>
                {inputs.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {deviceLabel(d, i, "Mikrofon")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold text-text-1">
                Ses Çıkışı (Hoparlör)
              </label>
              <select
                value={speakerDeviceId ?? ""}
                onChange={(e) => onOutputChange(e.target.value)}
                className={selectCls}
              >
                <option value="">Sistem varsayılanı</option>
                {outputs.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {deviceLabel(d, i, "Çıkış")}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Global level sliders (live) */}
          <div className="space-y-2">
            <div>
              <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-text-1">
                <span>Mikrofon Seviyesi (giden)</span>
                <span className="tabular-nums text-text-0">
                  {gainToUi(micLevel)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={gainToUi(micLevel)}
                onChange={(e) => setMicLevel(uiToGain(Number(e.target.value)))}
                className="h-1.5 w-full accent-[var(--accent)]"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-text-1">
                <span>Ana Ses Seviyesi (gelen)</span>
                <span className="tabular-nums text-text-0">
                  {gainToUi(masterVolume)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={gainToUi(masterVolume)}
                onChange={(e) => setMasterVolume(uiToGain(Number(e.target.value)))}
                className="h-1.5 w-full accent-[var(--accent)]"
              />
            </div>
          </div>

          <MicTest micDeviceId={micDeviceId} speakerDeviceId={speakerDeviceId} />

          <div className="border-t border-edge pt-3">
            <PttSettings />
          </div>

          <div className="border-t border-edge pt-3">
            <button
              onClick={resetMediaPermissions}
              disabled={micStatus === "checking"}
              className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-bold text-bg-0 transition-opacity disabled:opacity-60"
              style={{
                background:
                  "linear-gradient(135deg, var(--accent), var(--accent-2))",
              }}
            >
              <MicIcon width={15} height={15} />
              {micStatus === "checking" ? "İsteniyor…" : "Medya İzinlerini Sıfırla"}
            </button>
            {micStatus === "granted" && (
              <div className="mt-2 text-center">
                <p className="text-xs text-success">
                  Mikrofon erişimi verildi ✓ — bir ses kanalına gir ve başla.
                </p>
                {micInputs.length > 0 && (
                  <p className="mt-1 truncate text-[10px] text-text-1">
                    {micInputs.length} giriş · {micInputs[0]}
                  </p>
                )}
              </div>
            )}
            {micStatus === "blocked" && (
              <div className="mt-2 space-y-2 text-center">
                <p className="text-xs text-danger">
                  Hâlâ kullanılamıyor — penceredeki adımları izle, sonra tekrar
                  dene.
                </p>
                <button
                  onClick={() => window.location.reload()}
                  className="rounded-md border border-edge px-3 py-1.5 text-[11px] font-semibold text-text-1 transition-colors hover:text-text-0"
                >
                  Uygulamayı yenile
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Profile */}
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-text-1">
          Profil
        </h3>
        <div className="mb-6 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Avatar
              nickname={profile?.nickname ?? "?"}
              avatarUrl={profile?.avatar_url}
              size={48}
            />
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png, image/jpeg, image/jpg"
              className="hidden"
              onChange={(e) => onAvatarFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarBusy}
              className="rounded-lg border border-edge bg-bg-2 px-3 py-2 text-xs font-semibold text-text-0 transition-colors hover:border-accent disabled:opacity-50"
            >
              {avatarBusy ? "İşleniyor…" : "Avatar yükle"}
            </button>
            {profile?.avatar_url && (
              <button
                onClick={removeAvatar}
                disabled={avatarBusy}
                className="flex items-center gap-1 rounded-lg border border-danger/40 px-3 py-2 text-xs font-semibold text-danger transition-colors hover:bg-danger hover:text-white disabled:opacity-50"
                title="Profil resmini kaldır"
              >
                <TrashIcon width={13} height={13} />
                Profil Resmini Kaldır
              </button>
            )}
            <span className="w-full text-[10px] text-text-1">
              PNG/JPEG · otomatik 128×128'e küçültülür
            </span>
          </div>
          <div className="flex gap-2">
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Takma ad"
              maxLength={24}
              className="flex-1 rounded-lg border border-edge bg-bg-2 px-3 py-2 text-sm outline-none focus:border-accent select-text"
            />
            <button
              onClick={saveProfile}
              disabled={saving}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-bg-0 transition-opacity disabled:opacity-50"
            >
              {saved ? "Kaydedildi ✓" : saving ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </div>

        {/* Admin-only: banned-user management */}
        {isAdmin && (
          <>
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-text-1">
              Yönetim
            </h3>
            <button
              onClick={() => setBannedOpen(true)}
              className="mb-6 w-full rounded-lg border border-edge bg-bg-2 py-2 text-xs font-bold text-text-0 transition-colors hover:border-accent"
            >
              Engellenmiş Kişileri Gör
            </button>
          </>
        )}

        <button
          onClick={() => signOut()}
          className="w-full rounded-lg border border-danger/40 py-2 text-xs font-bold text-danger transition-colors hover:bg-danger hover:text-white"
        >
          Çıkış yap
        </button>
      </div>

      {bannedOpen && <BannedUsersModal onClose={() => setBannedOpen(false)} />}
    </div>
  );
}
