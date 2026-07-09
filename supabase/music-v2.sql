-- ═══════════════════════════════════════════════════════════════════
-- AOCom v0.2.1 — music polish: ordered queue, triple-loop, history.
-- Run ONCE in Supabase Dashboard → SQL Editor. Fresh installs: schema.sql.
-- ═══════════════════════════════════════════════════════════════════

-- Explicit float ordering (enables shuffle, drag-reorder, re-insert).
alter table public.music_queue
  add column if not exists position double precision not null default 0;
update public.music_queue
  set position = extract(epoch from created_at)
  where position = 0;

-- Triple-state loop + play history (for the Previous button).
alter table public.room_sessions
  add column if not exists loop_mode text not null default 'none';
alter table public.room_sessions
  drop constraint if exists room_sessions_loop_mode_chk;
alter table public.room_sessions
  add constraint room_sessions_loop_mode_chk
  check (loop_mode in ('none', 'track', 'queue'));
alter table public.room_sessions
  add column if not exists history jsonb not null default '[]'::jsonb;
