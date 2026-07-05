import type { ReactNode } from "react";

/**
 * Lightweight chat markdown: **bold**, *italic*, `inline code`.
 * Renders straight to React nodes — no HTML strings, so message content
 * can never inject markup (XSS-safe by construction).
 */
const TOKEN_RE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;

export function renderMarkdown(text: string): ReactNode[] {
  return text.split(TOKEN_RE).map((part, i) => {
    if (!part) return null;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-bg-3 px-1 py-0.5 font-mono text-[0.85em] text-accent"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-bold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
      return (
        <em key={i} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}
