export type ChannelType = "text" | "voice";
export type InputMode = "voice" | "ptt";

/**
 * The one squad admin allowed to manage channels. The same check is
 * enforced server-side via a Supabase RLS policy on public.channels —
 * hiding the buttons is cosmetic, the database is the real guard.
 */
export const ADMIN_EMAIL = "samet.ozturk.uye@gmail.com";
export const isAdminEmail = (email?: string | null): boolean =>
  email === ADMIN_EMAIL;

/** Exact copy shown to banned users and to signups while intake is closed. */
export const BAN_MESSAGE = "Girişiniz yasak yöneticiyle görüşün";

export interface SystemSettings {
  id: number;
  is_registration_open: boolean;
  updated_at: string;
}
export type ThemeName = "nordic" | "graphite" | "mutedcyber" | "tactical";

export const THEME_NAMES: ThemeName[] = [
  "nordic",
  "graphite",
  "mutedcyber",
  "tactical",
];

/** Old neon palette ids (pre-matte) map to their closest matte successor. */
export const THEME_MIGRATION: Record<string, ThemeName> = {
  midnight: "nordic",
  cyberpunk: "mutedcyber",
  vampire: "graphite",
  emerald: "tactical",
};
export type VideoQuality = "360p" | "480p" | "720p";

export interface Profile {
  id: string;
  nickname: string;
  avatar_url: string | null;
  is_active?: boolean;
  has_chat_ban?: boolean;
  has_voice_ban?: boolean;
  last_seen_at?: string | null;
  updated_at?: string;
}

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  created_at?: string;
}

export interface Message {
  id: number;
  channel_id: string;
  user_id: string;
  content: string;
  attachment_url: string | null;
  created_at: string;
}

export interface ActiveStatus {
  user_id: string;
  is_online: boolean;
  current_voice_channel: string | null;
  updated_at: string;
}

export interface RingPayload {
  from: string;
  fromNick: string;
  avatarUrl: string | null;
  channelId: string;
  channelName: string;
}

export const QUALITY_PRESETS: Record<
  VideoQuality,
  { width: number; height: number; frameRate: number }
> = {
  "360p": { width: 640, height: 360, frameRate: 20 },
  "480p": { width: 854, height: 480, frameRate: 24 },
  "720p": { width: 1280, height: 720, frameRate: 30 },
};
