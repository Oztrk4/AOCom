-- ═══════════════════════════════════════════════════════════════════
-- AOCom patch: admin panel (user ban), registration gate, last-seen.
-- Run ONCE in Supabase Dashboard → SQL Editor on the existing project.
-- Fresh installs get the same via the updated schema.sql.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Profile columns: ban flag + last-seen heartbeat ──────────────

alter table public.profiles
  add column if not exists is_active boolean not null default true;
alter table public.profiles
  add column if not exists last_seen_at timestamptz;

-- ── 2. System settings (single-row config table) ────────────────────

create table if not exists public.system_settings (
  id int primary key default 1 check (id = 1),
  is_registration_open boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.system_settings (id) values (1) on conflict (id) do nothing;

alter table public.system_settings enable row level security;

-- Anyone (incl. anon, pre-signup) may READ the flag; only the admin
-- may flip it.
create policy "settings readable"
  on public.system_settings for select to anon, authenticated using (true);
create policy "admin updates settings"
  on public.system_settings for update to authenticated
  using ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com');

-- ── 3. Admin may update any profile (ban/unban) ─────────────────────

create policy "admin manages profiles"
  on public.profiles for update to authenticated
  using ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com');

-- ── 4. Server-side teeth for the ban: passive users cannot post ─────

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_active from public.profiles where id = auth.uid()),
    false
  );
$$;

drop policy if exists "send messages as yourself" on public.messages;
create policy "send messages as yourself"
  on public.messages for insert to authenticated
  with check (auth.uid() = user_id and public.is_active_user());

-- ── 5. Server-side teeth for the registration gate: closing intake
--      makes signup fail at the database, not just in the UI ─────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(
       (select is_registration_open from public.system_settings where id = 1),
       true
     )
     and new.email is distinct from 'samet.ozturk.uye@gmail.com'
  then
    raise exception 'registration_closed';
  end if;

  insert into public.profiles (id, nickname)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nickname', split_part(new.email, '@', 1))
  );
  insert into public.active_status (user_id, is_online)
  values (new.id, false);
  return new;
end;
$$;
