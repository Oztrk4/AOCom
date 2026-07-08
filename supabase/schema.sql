-- ═══════════════════════════════════════════════════════════════════
-- AOCom — Supabase schema. Paste this whole file into the Supabase
-- Dashboard → SQL Editor and run it once on a fresh project.
-- ═══════════════════════════════════════════════════════════════════

-- ── Tables ──────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  -- M3: avatar_url may only reference our own Supabase Storage bucket,
  -- never an arbitrary external URL (blocks IP-harvesting beacons).
  avatar_url text check (
    avatar_url is null
    or avatar_url ~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/'
  ),
  is_active boolean not null default true,
  has_chat_ban boolean not null default false,
  has_voice_ban boolean not null default false,
  last_seen_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Single-row app configuration (registration gate etc.)
create table public.system_settings (
  id int primary key default 1 check (id = 1),
  is_registration_open boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.system_settings (id) values (1);

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
  -- Registration gate: when intake is closed only the admin may sign up.
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

-- Ban check helpers (security definer so RLS can consult profiles).
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

-- App-active AND not chat-banned → may send messages.
create or replace function public.can_send_messages()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select is_active and not has_chat_ban from public.profiles where id = auth.uid()),
    false
  );
$$;

-- App-active AND not voice-banned → may join voice channels.
create or replace function public.can_use_voice()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select is_active and not has_voice_ban from public.profiles where id = auth.uid()),
    false
  );
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

-- Own row always readable (so the live-ban kick can see is_active flip);
-- everyone else's row only while the reader is active.
create policy "profiles readable by active members"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_active_user()));
create policy "update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);
create policy "admin manages profiles"
  on public.profiles for update to authenticated
  using ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com');

alter table public.system_settings enable row level security;
create policy "settings readable"
  on public.system_settings for select to anon, authenticated using (true);
create policy "admin updates settings"
  on public.system_settings for update to authenticated
  using ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com');

create policy "channels readable by active members"
  on public.channels for select to authenticated
  using ((select public.is_active_user()));
-- HARD GUARD: only the squad admin account may create/rename/delete
-- channels — enforced by Postgres, not just hidden buttons.
create policy "admin manages channels"
  on public.channels for all to authenticated
  using ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com');

create policy "messages readable by active members"
  on public.messages for select to authenticated
  using ((select public.is_active_user()));
create policy "send messages as yourself"
  on public.messages for insert to authenticated
  with check (auth.uid() = user_id and public.can_send_messages());
create policy "delete own messages"
  on public.messages for delete to authenticated
  using (auth.uid() = user_id);
-- Admin may delete ANY message.
create policy "admin deletes any message"
  on public.messages for delete to authenticated
  using ((auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com');

create policy "status readable by active members"
  on public.active_status for select to authenticated
  using ((select public.is_active_user()));
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

-- ── Realtime Authorization: private voice/ring/presence channels ─────
-- Only active members may subscribe to (receive) or broadcast on the
-- P2P signaling channels — blocks peer-IP harvesting and caller spoofing.
alter table realtime.messages enable row level security;

-- voice:* requires can_use_voice() (blocks voice-banned); ring/presence
-- require an active session.
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

-- ── Storage: public bucket for chat attachments (25 MB cap) ─────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', true, 26214400)
on conflict (id) do nothing;

-- M4: writes constrained to the uploader's own folder + safe file types.
-- Chat attachments: <uid>/... ; avatars: avatars/<uid>/...
create policy "users upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (
      (storage.foldername(name))[1] = (auth.uid())::text
      or (
        (storage.foldername(name))[1] = 'avatars'
        and (storage.foldername(name))[2] = (auth.uid())::text
      )
    )
    and lower(storage.extension(name)) = any (array[
      'png','jpg','jpeg','gif','webp','avif','bmp',
      'pdf','txt','zip','rar','7z',
      'mp3','ogg','wav','m4a','mp4','webm','mov','mkv',
      'doc','docx','xls','xlsx','ppt','pptx','csv','json','log'
    ])
  );
create policy "users manage own uploads"
  on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and owner = auth.uid());
create policy "users delete own uploads"
  on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and owner = auth.uid());
-- Public read preserved so existing image/attachment links keep working.
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
