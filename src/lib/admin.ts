import { supabase } from "./supabase";

/**
 * Admin action: eject a user from their voice channel. Clears that user's
 * active_status.current_voice_channel; the kicked client picks the change up
 * over the existing `db-sync` postgres_changes stream and immediately tears
 * down its WebRTC voice session (see useBootstrap → kicked signal).
 *
 * Requires the "admin manages status" RLS policy — supabase/admin-kick.sql.
 * Returns true on success.
 */
export async function kickFromVoice(targetId: string): Promise<boolean> {
  const { error } = await supabase
    .from("active_status")
    .update({
      current_voice_channel: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", targetId);
  if (error) console.error("[aocom-admin] kick failed", error);
  return !error;
}
