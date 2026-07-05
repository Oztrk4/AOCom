-- ═══════════════════════════════════════════════════════════════════
-- AOCom — Supabase schema. Paste this whole file into the Supabase
-- Dashboard → SQL Editor and run it once on a fresh project.
-- ═══════════════════════════════════════════════════════════════════

-- ── Tables ──────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  avatar_url text,
  updated_at timestamptz not null default now()
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text not null check (type in ('text', 'voice')),
  created_at timestamptz not null default now()
);

create table public.messages (
  id bigint generated always as identity primary key,
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  content text not null default '',
  attachment_url text,
  created_at timestamptz not null default now()
);

create index messages_channel_created_idx
  on public.messages (channel_id, created_at desc);

create table public.active_status (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  is_online boolean not null default false,
  current_voice_channel uuid references public.channels (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ── Auto-create a profile + status row on signup ────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Row Level Security (friend-group model: any authenticated member
--    can read everything; you can only write as yourself) ────────────

alter table public.profiles enable row level security;
alter table public.channels enable row level security;
alter table public.messages enable row level security;
alter table public.active_status enable row level security;

create policy "profiles readable by members"
  on public.profiles for select to authenticated using (true);
create policy "update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

create policy "channels readable by members"
  on public.channels for select to authenticated using (true);
-- HARD GUARD: only the squad admin account may create/rename/delete
-- channels — enforced by Postgres, not just hidden buttons.
create policy "admin manages channels"
  on public.channels for all to authenticated
  using ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com');

create policy "messages readable by members"
  on public.messages for select to authenticated using (true);
create policy "send messages as yourself"
  on public.messages for insert to authenticated
  with check (auth.uid() = user_id);
create policy "delete own messages"
  on public.messages for delete to authenticated
  using (auth.uid() = user_id);

create policy "status readable by members"
  on public.active_status for select to authenticated using (true);
create policy "insert own status"
  on public.active_status for insert to authenticated
  with check (auth.uid() = user_id);
create policy "update own status"
  on public.active_status for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Realtime: broadcast DB changes to clients ───────────────────────

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.active_status;
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.channels;

-- ── Storage: public bucket for chat attachments (25 MB cap) ─────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', true, 26214400)
on conflict (id) do nothing;

create policy "members upload attachments"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments');
create policy "attachments are public"
  on storage.objects for select to public
  using (bucket_id = 'attachments');

-- ── Seed the squad's channels ────────────────────────────────────────

insert into public.channels (name, type) values
  ('general',  'text'),
  ('memes',    'text'),
  ('Lobi',     'voice'),
  ('Valorant', 'voice')
on conflict (name) do nothing;
