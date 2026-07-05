import { createClient, type SupportedStorage } from "@supabase/supabase-js";

/**
 * Session tokens persist natively through tauri-plugin-store
 * (%APPDATA%/com.aocom.desktop/aocom-auth.json) so auto-login survives
 * webview cache clears. Falls back to localStorage when running `next dev`
 * in a plain browser.
 */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type TauriStore = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
};

let storePromise: Promise<TauriStore> | null = null;
function tauriStore(): Promise<TauriStore> {
  if (!storePromise) {
    storePromise = import("@tauri-apps/plugin-store").then((m) =>
      m.load("aocom-auth.json", { autoSave: true, defaults: {} })
    );
  }
  return storePromise;
}

const nativeStorage: SupportedStorage = {
  async getItem(key) {
    if (!isTauri()) return globalThis.localStorage?.getItem(key) ?? null;
    const store = await tauriStore();
    return (await store.get<string>(key)) ?? null;
  },
  async setItem(key, value) {
    if (!isTauri()) return void globalThis.localStorage?.setItem(key, value);
    const store = await tauriStore();
    await store.set(key, value);
  },
  async removeItem(key) {
    if (!isTauri()) return void globalThis.localStorage?.removeItem(key);
    const store = await tauriStore();
    await store.delete(key);
  },
};

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: nativeStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  }
);
