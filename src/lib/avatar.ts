/**
 * M3 fix: avatar_url must never be an arbitrary external URL, or a
 * malicious user could use it as an IP-harvesting / presence beacon that
 * fires from every viewer's client. Avatars are always uploaded to our
 * Supabase Storage bucket, so we only render URLs whose host is a
 * *.supabase.co origin over https. Anything else falls back to initials.
 *
 * This mirrors the server-side CHECK constraint on profiles.avatar_url —
 * defense in depth: the DB refuses to store a bad value, and the client
 * refuses to load one even if it somehow exists.
 */
export function isSafeAvatarUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".supabase.co");
  } catch {
    return false;
  }
}
