import type { RingPayload } from "./types";

/** All Tauri calls live here and no-op gracefully in a plain browser. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/** Smoothly tween the native window to a new logical size, then center it. */
export async function animateResize(w: number, h: number, ms = 260) {
  if (!isTauri()) return;
  const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  await win.setResizable(true);
  const scale = await win.scaleFactor();
  const cur = await win.innerSize();
  const from = { w: cur.width / scale, h: cur.height / scale };
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const t = easeInOut(i / steps);
    await win.setSize(
      new LogicalSize(from.w + (w - from.w) * t, from.h + (h - from.h) * t)
    );
    await sleep(ms / steps);
  }
  await win.center();
}

export async function enterDashboardWindow() {
  await animateResize(1200, 800);
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setResizable(true);
}

export async function enterLoginWindow() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await animateResize(450, 650);
  await getCurrentWindow().setResizable(false);
}

export async function minimizeWindow() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeWindow() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().toggleMaximize();
}

export async function closeWindow() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

export async function focusMainWindow() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  if (await win.isMinimized()) await win.unminimize();
  await win.show();
  await win.setFocus();
}

export async function isAppInBackground(): Promise<boolean> {
  if (!isTauri()) return typeof document !== "undefined" && document.hidden;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  return (await win.isMinimized()) || !(await win.isFocused());
}

/** Native OS toast via the Tauri notification plugin. */
export async function notify(title: string, body: string) {
  if (!isTauri()) return;
  const { isPermissionGranted, requestPermission, sendNotification } =
    await import("@tauri-apps/plugin-notification");
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (granted) sendNotification({ title, body });
}

const CALL_POPUP_LABEL = "incoming-call";
const POPUP_W = 340;
const POPUP_H = 130;

/** Teams-style transparent popup pinned to the bottom-right of the screen. */
export async function openCallPopup(ring: RingPayload) {
  if (!isTauri()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { currentMonitor } = await import("@tauri-apps/api/window");

  const existing = await WebviewWindow.getByLabel(CALL_POPUP_LABEL);
  if (existing) await existing.destroy();

  const monitor = await currentMonitor();
  const scale = monitor?.scaleFactor ?? 1;
  const mw = (monitor?.size.width ?? 1920) / scale;
  const mh = (monitor?.size.height ?? 1080) / scale;

  const qs = new URLSearchParams({
    nick: ring.fromNick,
    avatar: ring.avatarUrl ?? "",
    channel: ring.channelId,
    channelName: ring.channelName,
  });

  new WebviewWindow(CALL_POPUP_LABEL, {
    url: `/call/?${qs.toString()}`,
    width: POPUP_W,
    height: POPUP_H,
    x: mw - POPUP_W - 16,
    y: mh - POPUP_H - 64,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    shadow: false,
    focus: false,
  });
}

export async function closeCallPopup() {
  if (!isTauri()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(CALL_POPUP_LABEL);
  if (existing) await existing.destroy();
}

/** Cross-window events: the popup answers, the main window reacts. */
export type CallResponse = { accepted: boolean; channelId: string };

export async function emitCallResponse(res: CallResponse) {
  if (!isTauri()) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("main", "call-response", res);
}

export async function onCallResponse(
  handler: (res: CallResponse) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<CallResponse>("call-response", (e) =>
    handler(e.payload)
  );
  return unlisten;
}

/**
 * Native OS dialog via the Tauri dialog plugin; falls back to alert()
 * when running `next dev` in a plain browser.
 */
export async function nativeDialog(
  title: string,
  body: string,
  kind: "info" | "warning" | "error" = "info"
) {
  if (!isTauri()) {
    window.alert(`${title}\n\n${body}`);
    return;
  }
  const { message } = await import("@tauri-apps/plugin-dialog");
  await message(body, { title, kind });
}

/** Native yes/no confirmation dialog; falls back to window.confirm. */
export async function nativeConfirm(
  title: string,
  body: string
): Promise<boolean> {
  if (!isTauri()) return window.confirm(`${title}\n\n${body}`);
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(body, { title, kind: "warning" });
}

/** CORS-free fetch through the Rust HTTP client (for OpenGraph previews). */
export async function nativeFetchText(url: string): Promise<string | null> {
  try {
    if (isTauri()) {
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      const res = await tauriFetch(url, {
        method: "GET",
        headers: { "User-Agent": "Mozilla/5.0 AOCom" },
        connectTimeout: 5000,
      });
      if (!res.ok) return null;
      return await res.text();
    }
    const res = await fetch(url);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}
