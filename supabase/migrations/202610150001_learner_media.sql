-- A learner's own lesson audio: a recording transcribed in the desktop companion from a file on
-- their computer has no address on the web, so its (compressed) sound is kept here for them alone.
-- Each learner's files live under a folder named after their user id; nobody else can read, add
-- or remove them. Published lesson media stays in lesson-media, prepared by admins only.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('learner-media','learner-media',false,157286400,array['audio/mp4','audio/x-m4a','audio/mpeg','audio/aac','audio/ogg','audio/opus','audio/wav','audio/flac','audio/webm','video/mp4'])
on conflict(id) do nothing;

-- Bytes the signed-in learner already keeps (their room: 2 GB).
create function public.learner_media_bytes() returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum((o.metadata->>'size')::bigint),0)::bigint from storage.objects o
 where o.bucket_id='learner-media' and (storage.foldername(o.name))[1]=auth.uid()::text
$$;
revoke all on function public.learner_media_bytes() from public;
grant execute on function public.learner_media_bytes() to authenticated;

create policy "Learners read their own media" on storage.objects for select to authenticated using(
 bucket_id='learner-media' and (storage.foldername(name))[1]=auth.uid()::text
);
create policy "Learners add their own media" on storage.objects for insert to authenticated with check(
 bucket_id='learner-media' and (storage.foldername(name))[1]=auth.uid()::text and public.learner_media_bytes()<2147483648
);
create policy "Learners remove their own media" on storage.objects for delete to authenticated using(
 bucket_id='learner-media' and (storage.foldername(name))[1]=auth.uid()::text
);
