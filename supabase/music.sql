-- ═══════════════════════════════════════════════════════════════════
-- AOCom v0.2.0 — Music player: synced session + queue.
-- Run ONCE in Supabase Dashboard → SQL Editor. Fresh installs: schema.sql.
-- ═══════════════════════════════════════════════════════════════════

-- One synchronized playback state per voice channel.
create table if not exists public.room_sessions (
  channel_id uuid primary key references public.channels (id) on delete cascade,
  video_id text,
  title text,
  thumbnail text,
  duration int,
  added_by uuid references public.profiles (id) on delete set null,
  is_playing boolean not null default false,
  loop boolean not null default false,
  position_seconds double precision not null default 0,
  updated_at timestamptz not null default now()
);

-- Upcoming tracks (FIFO by created_at).
create table if not exists public.music_queue (
  id bigint generated always as identity primary key,
  channel_id uuid not null references public.channels (id) on delete cascade,
  video_id text not null,
  title text not null default '',
  thumbnail text,
  duration int,
  added_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists music_queue_channel_idx
  on public.music_queue (channel_id, created_at);

alter table public.room_sessions enable row level security;
alter table public.music_queue enable row level security;

-- Active members read; active members drive playback state.
drop policy if exists "sessions readable" on public.room_sessions;
create policy "sessions readable" on public.room_sessions
  for select to authenticated using ((select public.is_active_user()));
drop policy if exists "sessions writable by active" on public.room_sessions;
create policy "sessions writable by active" on public.room_sessions
  for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

drop policy if exists "queue readable" on public.music_queue;
create policy "queue readable" on public.music_queue
  for select to authenticated using ((select public.is_active_user()));
drop policy if exists "queue add as self" on public.music_queue;
create policy "queue add as self" on public.music_queue
  for insert to authenticated
  with check (added_by = auth.uid() and (select public.is_active_user()));
-- Only the adder OR the admin may remove a queued track.
drop policy if exists "queue delete own or admin" on public.music_queue;
create policy "queue delete own or admin" on public.music_queue
  for delete to authenticated
  using (
    added_by = auth.uid()
    or (auth.jwt() ->> 'email') = 'samet.ozturk.uye@gmail.com'
  );

-- Broadcast table changes to the room.
alter publication supabase_realtime add table public.room_sessions;
alter publication supabase_realtime add table public.music_queue;

-- Realtime Authorization: add music:* private channel (votes + presence)
-- alongside the existing voice/ring/presence topics.
drop policy if exists "active users receive squad realtime" on realtime.messages;
create policy "active users receive squad realtime"
  on realtime.messages for select to authenticated
  using (
    case
      when realtime.topic() like 'voice:%' then (select public.can_use_voice())
      when realtime.topic() like 'ring:%'
        or realtime.topic() like 'music:%'
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
        or realtime.topic() like 'music:%'
        or realtime.topic() = 'presence:online' then (select public.is_active_user())
      else false
    end
  );
