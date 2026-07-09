import { nativeFetchText } from "./tauri";

/**
 * YouTube helpers. Playback uses the official IFrame Player API (the only
 * keyless, ToS-clean way to play YouTube inside a webview). Metadata comes
 * from the keyless oEmbed endpoint, fetched through the SSRF-safe Rust
 * command. Free-text search would require a YouTube Data API key — drop it
 * into `searchYouTube` when you have one.
 */

/** Extract an 11-char video id from a URL or accept a raw id. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  const patterns = [
    /youtube\.com\/watch\?[^ ]*v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /youtube\.com\/(?:embed|shorts|v)\/([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  return /^[\w-]{11}$/.test(s) ? s : null;
}

export interface YtMeta {
  videoId: string;
  title: string;
  thumbnail: string;
}

const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/** Keyless title + thumbnail via YouTube oEmbed (through the Rust fetch). */
export async function fetchYouTubeMeta(id: string): Promise<YtMeta> {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`;
  const text = await nativeFetchText(url);
  if (text) {
    try {
      const j = JSON.parse(text) as { title?: string; thumbnail_url?: string };
      return {
        videoId: id,
        title: j.title ?? id,
        thumbnail: j.thumbnail_url ?? thumb(id),
      };
    } catch {
      /* fall through */
    }
  }
  return { videoId: id, title: id, thumbnail: thumb(id) };
}

/**
 * Free-text search without a Data API key: fetch YouTube's results page
 * (through the SSRF-safe Rust command, which bypasses CORS) and pull the
 * first video id out of the embedded ytInitialData. Fragile by nature —
 * if YouTube changes its markup this returns null and the caller falls
 * back to asking for a link. Then oEmbed fills title + thumbnail.
 */
export async function searchYouTube(query: string): Promise<YtMeta | null> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const html = await nativeFetchText(url);
  if (!html) return null;
  const m = html.match(/"videoId":"([\w-]{11})"/);
  if (!m) return null;
  return fetchYouTubeMeta(m[1]);
}

/** Resolve any input (URL, raw id, or free-text query) to track metadata. */
export async function resolveTrack(input: string): Promise<YtMeta | null> {
  const id = parseYouTubeId(input);
  if (id) return fetchYouTubeMeta(id);
  return searchYouTube(input);
}

/** Loads the IFrame Player API once and resolves when `window.YT` is ready. */
let apiPromise: Promise<void> | null = null;
export function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).onYouTubeIframeAPIReady = () => resolve();
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

export function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec < 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
