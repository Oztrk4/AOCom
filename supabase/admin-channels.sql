-- ═══════════════════════════════════════════════════════════════════
-- AOCom patch: admin-only channel management + channels realtime.
-- Run this once in Supabase Dashboard → SQL Editor on the EXISTING
-- project (schema.sql already applied). New installs get the same
-- statements from the updated schema.sql.
-- ═══════════════════════════════════════════════════════════════════

-- HARD SECURITY GUARD: only this exact account may create / rename /
-- delete channels. The frontend hides the buttons for everyone else,
-- but this policy is what actually enforces it — a tampered client
-- gets a 403 from Postgres.
create policy "admin manages channels"
  on public.channels
  for all
  to authenticated
  using ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com');

-- Broadcast channel CRUD to all clients instantly.
alter publication supabase_realtime add table public.channels;
