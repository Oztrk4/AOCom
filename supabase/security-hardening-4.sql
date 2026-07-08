-- ═══════════════════════════════════════════════════════════════════
-- AOCom security hardening #4 — audit fixes C1, C2, H1.
-- Run ONCE in Supabase Dashboard → SQL Editor. Fresh installs get the
-- same from the updated schema.sql.
-- ═══════════════════════════════════════════════════════════════════

-- ── C1: block non-admins from changing their own moderation flags ────
-- RLS can gate the row but not columns, so a BEFORE UPDATE trigger does
-- it. Only the admin JWT may flip is_active / has_chat_ban / has_voice_ban;
-- everyone else may still edit nickname / avatar_url / last_seen_at.
create or replace function public.guard_profile_moderation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (auth.jwt() ->> 'email') <> 'samet.ozturk.uye@gmail.com' then
    if new.is_active     is distinct from old.is_active
    or new.has_chat_ban  is distinct from old.has_chat_ban
    or new.has_voice_ban is distinct from old.has_voice_ban then
      raise exception 'moderation flags are admin-only';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_moderation on public.profiles;
create trigger guard_profile_moderation
  before update on public.profiles
  for each row execute function public.guard_profile_moderation();

-- ── C2: attachments may only reference our own Storage bucket ────────
-- Scrub any pre-existing non-conforming rows, then enforce.
update public.messages
set attachment_url = null
where attachment_url is not null
  and attachment_url !~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/';

alter table public.messages
  drop constraint if exists attachment_from_storage;
alter table public.messages
  add constraint attachment_from_storage check (
    attachment_url is null
    or attachment_url ~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/'
  );

-- ── H1: server-side length caps (client maxLength is bypassable) ─────
update public.messages set content = left(content, 4000)
  where char_length(content) > 4000;
update public.profiles set nickname = left(nickname, 40)
  where char_length(nickname) > 40;

alter table public.messages
  drop constraint if exists content_len;
alter table public.messages
  add constraint content_len check (char_length(content) <= 4000);

alter table public.profiles
  drop constraint if exists nickname_len;
alter table public.profiles
  add constraint nickname_len check (char_length(nickname) between 1 and 40);
