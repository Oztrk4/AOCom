"use client";
import { useState } from "react";
import { Titlebar } from "@/components/layout/Titlebar";
import { useAppStore } from "@/stores/app-store";

export function LoginScreen({
  signIn,
  signUp,
}: {
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, nickname: string) => Promise<string | null>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Shown when a live ban kicked the session out (set in useBootstrap).
  const banNotice = useAppStore((s) => s.banNotice);
  const setBanNotice = useAppStore((s) => s.setBanNotice);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBanNotice(null);
    setBusy(true);
    const err =
      mode === "login"
        ? await signIn(email, password)
        : await signUp(email, password, nickname.trim() || email.split("@")[0]);
    if (err) setError(err);
    setBusy(false);
  };

  const inputCls =
    "w-full rounded-lg border border-edge bg-bg-2 px-4 py-3 text-sm text-text-0 " +
    "placeholder-text-1 outline-none transition-colors focus:border-accent";

  return (
    <div className="flex h-screen flex-col bg-bg-0">
      <Titlebar compact />
      <div
        data-tauri-drag-region
        className="flex flex-1 flex-col items-center justify-center px-10"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/aocom-logo-bg.png"
          alt="AOCom"
          draggable={false}
          className="mb-3 w-full max-w-[200px] select-none object-contain"
        />
        <p className="mb-8 text-sm text-text-1">
          {mode === "login" ? "Tekrar hoş geldin, efsane." : "Ekibe katıl."}
        </p>

        <form onSubmit={submit} className="w-full space-y-3">
          {mode === "register" && (
            <input
              className={inputCls}
              placeholder="Takma ad"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={24}
              required
            />
          )}
          <input
            className={inputCls}
            type="email"
            placeholder="E-posta"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            className={inputCls}
            type="password"
            placeholder="Parola"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={6}
            required
          />

          {(error ?? banNotice) && (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
              {error ?? banNotice}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg py-3 text-sm font-bold text-bg-0 transition-opacity disabled:opacity-50"
            style={{
              background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
            }}
          >
            {busy ? "…" : mode === "login" ? "Giriş Yap" : "Hesap Oluştur"}
          </button>
        </form>

        <button
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
          className="mt-6 text-xs text-text-1 transition-colors hover:text-accent"
        >
          {mode === "login"
            ? "Hesabın yok mu? Kayıt ol →"
            : "Zaten üye misin? Giriş yap →"}
        </button>
      </div>
      <p className="pb-4 text-center text-[10px] text-text-1/60">
        P2P şifreli · seninle ekibin arasında sıfır sunucu
      </p>
    </div>
  );
}
