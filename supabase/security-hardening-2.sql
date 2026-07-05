-- ═══════════════════════════════════════════════════════════════════
-- AOCom security hardening #2 — fixes audit findings M3 + M4.
-- Run ONCE in Supabase Dashboard → SQL Editor (after the earlier
-- security-hardening.sql). Fresh installs get the same from schema.sql.
-- ═══════════════════════════════════════════════════════════════════

-- ── M3: avatar_url may only point at our own Storage bucket ──────────
-- Blocks using avatar_url as an external IP-harvesting beacon. First
-- scrub any pre-existing non-conforming values so the constraint applies
-- cleanly, then enforce it.

update public.profiles
set avatar_url = null
where avatar_url is not null
  and avatar_url !~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/';

alter table public.profiles
  drop constraint if exists avatar_url_from_storage;
alter table public.profiles
  add constraint avatar_url_from_storage
  check (
    avatar_url is null
    or avatar_url ~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/'
  );

-- ── M4: users may only write to their OWN folder + safe file types ──
-- Chat attachments live under  <uid>/...   ; avatars under avatars/<uid>/...
-- (public read is intentionally preserved so existing image links keep
-- working; this only constrains WRITES and blocks executable/script types.)

drop policy if exists "members upload attachments" on storage.objects;
drop policy if exists "users upload to own folder" on storage.objects;
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

-- Let users manage (overwrite/remove) only their own uploads.
drop policy if exists "users manage own uploads" on storage.objects;
create policy "users manage own uploads"
  on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and owner = auth.uid());
drop policy if exists "users delete own uploads" on storage.objects;
create policy "users delete own uploads"
  on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and owner = auth.uid());
