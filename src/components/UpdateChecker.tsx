"use client";
import { useEffect, useState } from "react";
import { isTauri } from "@/lib/tauri";
import type { Update } from "@tauri-apps/plugin-updater";

/**
 * Launch-time auto-update flow:
 *  1. On app start (main window only), query the update.json endpoint on
 *     GitHub through the Tauri updater plugin — the signature is verified
 *     against the pubkey baked into tauri.conf.json before anything runs.
 *  2. If a newer version exists, show a themed confirmation modal.
 *  3. On approval, download + install in the background with a live
 *     progress bar, then relaunch straight into the new version.
 */
export function UpdateChecker() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        // Only the main window checks — never the incoming-call popup.
        if (getCurrentWindow().label !== "main") return;
        const { check } = await import("@tauri-apps/plugin-updater");
        const found = await check();
        if (found && !cancelled) setUpdate(found);
      } catch {
        // Offline, repo not reachable, or update.json not published yet —
        // stay silent, the app works as-is.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const install = async () => {
    if (!update) return;
    setFailed(false);
    setProgress(0);
    let total = 0;
    let received = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (total > 0) setProgress(Math.min(1, received / total));
        } else if (event.event === "Finished") {
          setProgress(1);
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      setProgress(null);
      setFailed(true);
    }
  };

  if (!update) return null;

  const downloading = progress !== null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-bg-0/80 backdrop-blur-sm">
      <div className="w-[420px] max-w-[90vw] rounded-2xl border border-edge bg-bg-1 p-5 shadow-2xl">
        <h2 className="mb-1 text-base font-bold">
          Güncelleme mevcut —{" "}
          <span className="text-accent">v{update.version}</span>
        </h2>
        <p className="mb-3 text-xs text-text-1">
          Şu an v{update.currentVersion} sürümündesin. Güncelleme arka planda
          kurulur ve AOCom otomatik olarak yeniden başlar.
        </p>

        {update.body && (
          <pre className="mb-3 max-h-36 overflow-y-auto whitespace-pre-wrap rounded-xl border border-edge bg-bg-2 p-3 text-[11px] leading-relaxed text-text-0/90">
            {update.body}
          </pre>
        )}

        {downloading ? (
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-bg-3">
              <div
                className="h-full rounded-full transition-[width] duration-150"
                style={{
                  width: `${Math.round((progress ?? 0) * 100)}%`,
                  background:
                    "linear-gradient(90deg, var(--accent), var(--accent-2))",
                }}
              />
            </div>
            <p className="text-center text-[11px] text-text-1">
              {progress === 1
                ? "Kuruluyor… birazdan yeniden başlıyor"
                : `İndiriliyor… ${Math.round((progress ?? 0) * 100)}%`}
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            {failed && (
              <span className="mr-auto text-[11px] text-danger">
                Güncelleme başarısız — bağlantını kontrol edip tekrar dene.
              </span>
            )}
            <button
              onClick={() => setUpdate(null)}
              className="rounded-lg border border-edge px-3 py-2 text-xs font-semibold text-text-1 transition-colors hover:text-text-0"
            >
              Sonra
            </button>
            <button
              onClick={install}
              className="rounded-lg px-4 py-2 text-xs font-bold text-bg-0 transition-opacity hover:opacity-90"
              style={{
                background:
                  "linear-gradient(135deg, var(--accent), var(--accent-2))",
              }}
            >
              Şimdi güncelle
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
