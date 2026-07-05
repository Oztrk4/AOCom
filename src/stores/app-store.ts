import { create } from "zustand";
import {
  THEME_MIGRATION,
  THEME_NAMES,
  type ActiveStatus,
  type Channel,
  type InputMode,
  type Profile,
  type RingPayload,
  type ThemeName,
  type VideoQuality,
} from "@/lib/types";

function initialTheme(): ThemeName {
  if (typeof window === "undefined") return "nordic";
  const saved = localStorage.getItem("aocom-theme") ?? "";
  if (THEME_NAMES.includes(saved as ThemeName)) return saved as ThemeName;
  return THEME_MIGRATION[saved] ?? "nordic";
}

interface AppState {
  profile: Profile | null;
  profiles: Record<string, Profile>;
  channels: Channel[];
  activeTextChannel: Channel | null;
  voiceChannel: Channel | null;
  statuses: Record<string, ActiveStatus>;
  onlineIds: Set<string>;
  theme: ThemeName;
  muted: boolean;
  deafened: boolean;
  camOn: boolean;
  quality: VideoQuality;
  incomingRing: RingPayload | null;
  settingsOpen: boolean;
  micError: string | null;
  micDeviceId: string | null;
  speakerDeviceId: string | null;
  theaterMode: boolean;
  inputMode: InputMode;
  pttKey: string | null;
  /** True while the PTT key is held (incl. the release hang time). */
  pttActive: boolean;

  setProfile: (p: Profile | null) => void;
  setProfiles: (list: Profile[]) => void;
  upsertProfile: (p: Profile) => void;
  setChannels: (c: Channel[]) => void;
  setActiveTextChannel: (c: Channel | null) => void;
  setVoiceChannel: (c: Channel | null) => void;
  setStatuses: (s: ActiveStatus[]) => void;
  upsertStatus: (s: ActiveStatus) => void;
  setOnlineIds: (ids: string[]) => void;
  setTheme: (t: ThemeName) => void;
  setMuted: (v: boolean) => void;
  setDeafened: (v: boolean) => void;
  setCamOn: (v: boolean) => void;
  setQuality: (q: VideoQuality) => void;
  setIncomingRing: (r: RingPayload | null) => void;
  setSettingsOpen: (v: boolean) => void;
  setMicError: (msg: string | null) => void;
  setMicDeviceId: (id: string | null) => void;
  setSpeakerDeviceId: (id: string | null) => void;
  setTheaterMode: (v: boolean) => void;
  setInputMode: (m: InputMode) => void;
  setPttKey: (k: string | null) => void;
  setPttActive: (v: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  profile: null,
  profiles: {},
  channels: [],
  activeTextChannel: null,
  voiceChannel: null,
  statuses: {},
  onlineIds: new Set(),
  theme: initialTheme(),
  muted: false,
  deafened: false,
  camOn: false,
  quality: "480p",
  incomingRing: null,
  settingsOpen: false,
  micError: null,
  micDeviceId:
    typeof window !== "undefined" ? localStorage.getItem("aocom-mic") : null,
  speakerDeviceId:
    typeof window !== "undefined" ? localStorage.getItem("aocom-speaker") : null,
  theaterMode: false,
  inputMode:
    typeof window !== "undefined" &&
    localStorage.getItem("aocom-input-mode") === "ptt"
      ? "ptt"
      : "voice",
  pttKey:
    typeof window !== "undefined" ? localStorage.getItem("aocom-ptt-key") : null,
  pttActive: false,

  setProfile: (profile) => set({ profile }),
  setProfiles: (list) =>
    set({ profiles: Object.fromEntries(list.map((p) => [p.id, p])) }),
  upsertProfile: (p) =>
    set((s) => ({ profiles: { ...s.profiles, [p.id]: p } })),
  setChannels: (channels) => set({ channels }),
  setActiveTextChannel: (activeTextChannel) => set({ activeTextChannel }),
  setVoiceChannel: (voiceChannel) => set({ voiceChannel }),
  setStatuses: (list) =>
    set({ statuses: Object.fromEntries(list.map((s) => [s.user_id, s])) }),
  upsertStatus: (st) =>
    set((s) => ({ statuses: { ...s.statuses, [st.user_id]: st } })),
  setOnlineIds: (ids) => set({ onlineIds: new Set(ids) }),
  setTheme: (theme) => {
    localStorage.setItem("aocom-theme", theme);
    document.documentElement.dataset.theme = theme;
    set({ theme });
  },
  setMuted: (muted) => set({ muted }),
  setDeafened: (deafened) =>
    set((s) => ({ deafened, muted: deafened ? true : s.muted })),
  setCamOn: (camOn) => set({ camOn }),
  setQuality: (quality) => set({ quality }),
  setIncomingRing: (incomingRing) => set({ incomingRing }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setMicError: (micError) => set({ micError }),
  setMicDeviceId: (micDeviceId) => {
    if (micDeviceId) localStorage.setItem("aocom-mic", micDeviceId);
    else localStorage.removeItem("aocom-mic");
    set({ micDeviceId });
  },
  setSpeakerDeviceId: (speakerDeviceId) => {
    if (speakerDeviceId) localStorage.setItem("aocom-speaker", speakerDeviceId);
    else localStorage.removeItem("aocom-speaker");
    set({ speakerDeviceId });
  },
  setTheaterMode: (theaterMode) => set({ theaterMode }),
  setInputMode: (inputMode) => {
    localStorage.setItem("aocom-input-mode", inputMode);
    set({ inputMode, pttActive: false });
  },
  setPttKey: (pttKey) => {
    if (pttKey) localStorage.setItem("aocom-ptt-key", pttKey);
    else localStorage.removeItem("aocom-ptt-key");
    set({ pttKey, pttActive: false });
  },
  setPttActive: (pttActive) => set({ pttActive }),
}));

/**
 * Single source of truth for "is the outgoing mic track live right now":
 * mute/deafen always win; in PTT mode the held key gates everything, so
 * the track is hard-disabled (zero packets, dead silent) until pressed.
 */
export function isMicLive(
  s: Pick<AppState, "muted" | "deafened" | "inputMode" | "pttActive">
): boolean {
  return !s.muted && !s.deafened && (s.inputMode === "voice" || s.pttActive);
}
