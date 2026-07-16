-- ── Admin: "Kick from Channel" (Kanaldan At) ───────────────────────────
-- Lets the squad admin clear ANY user's voice session by setting
-- active_status.current_voice_channel = null. The kicked client sees the
-- change over the existing `db-sync` postgres_changes stream and tears its
-- WebRTC session down immediately.
--
-- Until now active_status could only be written by its owner
-- (auth.uid() = user_id); this adds an admin-scoped UPDATE policy alongside
-- it. Run this once in the Supabase SQL editor.

drop policy if exists "admin manages status" on public.active_status;
create policy "admin manages status"
  on public.active_status for update to authenticated
  using ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com');
