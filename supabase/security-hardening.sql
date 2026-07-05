-- ═══════════════════════════════════════════════════════════════════
-- AOCom security hardening — fixes audit findings C2 + H1.
-- Run ONCE in Supabase Dashboard → SQL Editor on the existing project.
-- Fresh installs get the same rules from the updated schema.sql.
--
-- Effect: passive (banned) users become blind to all squad data and are
-- disconnected from voice/ring/presence signaling. Every SELECT and every
-- private Realtime channel now checks public.is_active_user().
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Table SELECT policies now require an ACTIVE session ───────────

-- profiles: a user may ALWAYS read their own row (so the live-ban kick
-- can observe is_active flipping), but others only while active.
drop policy if exists "profiles readable by members" on public.profiles;
drop policy if exists "profiles readable by active members" on public.profiles;
create policy "profiles readable by active members"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_active_user()));

drop policy if exists "channels readable by members" on public.channels;
create policy "channels readable by active members"
  on public.channels for select to authenticated
  using ((select public.is_active_user()));

drop policy if exists "messages readable by members" on public.messages;
create policy "messages readable by active members"
  on public.messages for select to authenticated
  using ((select public.is_active_user()));

drop policy if exists "status readable by members" on public.active_status;
create policy "status readable by active members"
  on public.active_status for select to authenticated
  using ((select public.is_active_user()));

-- ── 2. Realtime Authorization for private voice/ring/presence channels
--      (fixes C2: previously ANY authenticated client could subscribe to
--       any voice:*/ring:* channel to harvest peer IPs, spoof callers, or
--       inject signaling). realtime.messages RLS only applies to channels
--       the client opens with { config: { private: true } }; the public
--       postgres_changes channels (messages:*, db-sync) are unaffected and
--       remain gated by the table policies above. ────────────────────

alter table realtime.messages enable row level security;

drop policy if exists "active users receive squad realtime" on realtime.messages;
create policy "active users receive squad realtime"
  on realtime.messages for select to authenticated
  using (
    (select public.is_active_user())
    and (
      realtime.topic() like 'voice:%'
      or realtime.topic() like 'ring:%'
      or realtime.topic() = 'presence:online'
    )
  );

drop policy if exists "active users send squad realtime" on realtime.messages;
create policy "active users send squad realtime"
  on realtime.messages for insert to authenticated
  with check (
    (select public.is_active_user())
    and (
      realtime.topic() like 'voice:%'
      or realtime.topic() like 'ring:%'
      or realtime.topic() = 'presence:online'
    )
  );
