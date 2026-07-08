-- ═══════════════════════════════════════════════════════════════════
-- AOCom — Admin message deletion + multi-ban system (chat / voice / app).
-- Run ONCE in Supabase Dashboard → SQL Editor. Fresh installs get the
-- same from the updated schema.sql.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. New ban columns ──────────────────────────────────────────────
alter table public.profiles
  add column if not exists has_chat_ban boolean not null default false;
alter table public.profiles
  add column if not exists has_voice_ban boolean not null default false;

-- ── 2. Capability helpers (security definer so RLS can read profiles) ─
create or replace function public.can_send_messages()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select is_active and not has_chat_ban from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.can_use_voice()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select is_active and not has_voice_ban from public.profiles where id = auth.uid()),
    false
  );
$$;

-- ── 3. Chat ban enforced server-side on message INSERT ──────────────
drop policy if exists "send messages as yourself" on public.messages;
create policy "send messages as yourself"
  on public.messages for insert to authenticated
  with check (auth.uid() = user_id and public.can_send_messages());

-- ── 4. Admin may delete ANY message (own-delete policy stays) ────────
drop policy if exists "admin deletes any message" on public.messages;
create policy "admin deletes any message"
  on public.messages for delete to authenticated
  using ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com');

-- ── 5. Voice ban enforced in Realtime authorization ─────────────────
-- Rebuild the private-channel policies so voice:* now requires
-- can_use_voice(); ring:* and presence stay on is_active_user().
drop policy if exists "active users receive squad realtime" on realtime.messages;
create policy "active users receive squad realtime"
  on realtime.messages for select to authenticated
  using (
    case
      when realtime.topic() like 'voice:%' then (select public.can_use_voice())
      when realtime.topic() like 'ring:%'
        or realtime.topic() = 'presence:online' then (select public.is_active_user())
      else false
    end
  );

drop policy if exists "active users send squad realtime" on realtime.messages;
create policy "active users send squad realtime"
  on realtime.messages for insert to authenticated
  with check (
    case
      when realtime.topic() like 'voice:%' then (select public.can_use_voice())
      when realtime.topic() like 'ring:%'
        or realtime.topic() = 'presence:online' then (select public.is_active_user())
      else false
    end
  );
