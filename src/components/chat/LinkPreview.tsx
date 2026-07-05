"use client";
import { useEffect, useState } from "react";
import { nativeFetchText } from "@/lib/tauri";

interface OGData {
  title: string;
  description: string | null;
  image: string | null;
  host: string;
}

// Module-level cache so a URL is fetched once per session.
const cache = new Map<string, OGData | null>();

function parseOG(html: string, url: string): OGData | null {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const meta = (prop: string) =>
      doc
        .querySelector(`meta[property="${prop}"], meta[name="${prop}"]`)
        ?.getAttribute("content") ?? null;
    const title = meta("og:title") ?? doc.title;
    if (!title) return null;
    return {
      title,
      description: meta("og:description") ?? meta("description"),
      image: meta("og:image"),
      host: new URL(url).host,
    };
  } catch {
    return null;
  }
}

export function LinkPreview({ url }: { url: string }) {
  const [og, setOg] = useState<OGData | null>(cache.get(url) ?? null);
  const [done, setDone] = useState(cache.has(url));

  useEffect(() => {
    if (cache.has(url)) return;
    let cancelled = false;
    nativeFetchText(url).then((html) => {
      const data = html ? parseOG(html, url) : null;
      cache.set(url, data);
      if (!cancelled) {
        setOg(data);
        setDone(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!done || !og) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mt-1.5 flex max-w-md gap-3 overflow-hidden rounded-lg border border-edge bg-bg-2 p-3 transition-colors hover:border-accent"
    >
      <div className="min-w-0 flex-1 border-l-2 border-accent pl-3">
        <p className="text-[10px] uppercase tracking-wide text-text-1">{og.host}</p>
        <p className="truncate text-sm font-semibold text-accent">{og.title}</p>
        {og.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-text-1">{og.description}</p>
        )}
      </div>
      {og.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={og.image}
          alt=""
          className="h-16 w-16 shrink-0 rounded-md object-cover"
          draggable={false}
        />
      )}
    </a>
  );
}
