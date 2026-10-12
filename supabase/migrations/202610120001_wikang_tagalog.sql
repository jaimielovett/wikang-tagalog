-- Run this migration in a new Supabase project. No service-role key is needed in either app.
create table public.admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.admins enable row level security;
create policy "Users see their own role" on public.admins for select to authenticated using (user_id=auth.uid());
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.admins where user_id=auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon,authenticated;

create table public.learner_state (
 user_id uuid primary key references auth.users(id) on delete cascade,
 data jsonb not null default '{}'::jsonb,
 revision bigint not null default 0,
 updated_at timestamptz not null default now(),
 constraint state_size check (octet_length(data::text)<=20000000)
);
alter table public.learner_state enable row level security;
create policy "Read own learning data" on public.learner_state for select to authenticated using(user_id=auth.uid());
-- All writes use a compare-and-swap function to prevent silent overwrites by a second device.
create function public.save_learner_state(expected_revision bigint,new_data jsonb) returns bigint
 language plpgsql security definer set search_path='' as $$
declare next_revision bigint;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 if jsonb_typeof(new_data)<>'object' then raise exception 'invalid_state'; end if;
 if expected_revision=0 then
  insert into public.learner_state(user_id,data,revision) values(auth.uid(),new_data,1)
   on conflict(user_id) do nothing returning revision into next_revision;
 else
  update public.learner_state set data=new_data,revision=revision+1,updated_at=now()
   where user_id=auth.uid() and revision=expected_revision returning revision into next_revision;
 end if;
 if next_revision is null then raise exception 'sync_conflict'; end if;
 return next_revision;
end;
$$;
revoke all on function public.save_learner_state(bigint,jsonb) from public;
grant execute on function public.save_learner_state(bigint,jsonb) to authenticated;

create table public.published_lessons (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id),
 lang text not null default 'tl' check(lang='tl'),
 status text not null default 'draft' check(status in('draft','review','published')),
 title text not null check(length(trim(title)) between 1 and 200),
 text text not null check(length(text) between 1 and 500000),
 collection text not null default '', kind text not null check(kind in('text','audio','video')),
 source_url text not null default '', shelf text not null default 'learn' check(shelf in('learn','news','culture','music')),
 lo integer not null default 1 check(lo between 1 and 5), hi integer not null default 5 check(hi between 1 and 5 and hi>=lo),
 duration double precision not null default 0 check(duration>=0),
 media_path text, video_path text, cover_path text,
 timings jsonb, tokens jsonb not null default '[]'::jsonb check(jsonb_typeof(tokens)='array'),
 timing_v integer not null default 0,
 created_at timestamptz not null default now(), published_at timestamptz,
 rights_confirmed boolean not null default false,
 constraint media_folder check ((media_path is null or media_path like id::text||'/%') and (video_path is null or video_path like id::text||'/%') and (cover_path is null or cover_path like id::text||'/%')),
 constraint publication_ready check(status<>'published' or (rights_confirmed and published_at is not null and jsonb_array_length(tokens)>0 and (kind='text' or (media_path is not null and timings is not null))))
);
alter table public.published_lessons enable row level security;
create policy "Public catalogue and admin queue" on public.published_lessons for select to anon,authenticated using(status='published' or public.is_admin());
create policy "Admins create drafts" on public.published_lessons for insert to authenticated with check(public.is_admin() and owner_id=auth.uid() and status='draft');
-- Transcript/media immutable after publication: republish as a new lesson so timings/progress stay aligned.
create policy "Admins update unpublished lessons" on public.published_lessons for update to authenticated using(public.is_admin() and status<>'published') with check(public.is_admin());
create policy "Admins delete unpublished lessons" on public.published_lessons for delete to authenticated using(public.is_admin() and status<>'published');
create index catalogue_order on public.published_lessons(published_at desc) where status='published';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('lesson-media','lesson-media',false,1073741824,array['audio/mp4','audio/mpeg','audio/wav','audio/ogg','video/mp4','video/webm','image/jpeg','image/png','image/webp']);
create policy "Read published media or admin drafts" on storage.objects for select to anon,authenticated using(
 bucket_id='lesson-media' and exists(select 1 from public.published_lessons l where l.id::text=(storage.foldername(name))[1] and (l.status='published' or public.is_admin()))
);
create policy "Admins upload to their draft" on storage.objects for insert to authenticated with check(
 bucket_id='lesson-media' and public.is_admin() and exists(select 1 from public.published_lessons l where l.id::text=(storage.foldername(name))[1] and l.owner_id=auth.uid() and l.status='draft')
);
create policy "Admins remove unpublished media" on storage.objects for delete to authenticated using(
 bucket_id='lesson-media' and public.is_admin() and exists(select 1 from public.published_lessons l where l.id::text=(storage.foldername(name))[1] and l.status<>'published')
);

create table public.service_usage(user_id uuid references auth.users(id) on delete cascade,day date,requests integer not null default 0,primary key(user_id,day));
alter table public.service_usage enable row level security;
create function public.consume_service_budget() returns void language plpgsql security definer set search_path='' as $$
declare count_now integer;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 insert into public.service_usage values(auth.uid(),current_date,1) on conflict(user_id,day)
 do update set requests=public.service_usage.requests+1 returning requests into count_now;
 if count_now>150 then raise exception 'daily_limit_reached'; end if;
end;
$$;
revoke all on function public.consume_service_budget() from public;
grant execute on function public.consume_service_budget() to authenticated;
-- Grant the first admin manually using the user's UUID from Authentication > Users:
-- insert into public.admins(user_id) values ('YOUR_USER_UUID');

-- Publication is an atomic visibility change after all required objects exist.
create function public.validate_lesson_publication() returns trigger language plpgsql set search_path='' as $$
declare object_path text; timing jsonb; utf16_length integer;
begin
 if new.status='published' and old.status<>'published' then
  if old.status<>'review' then raise exception 'Review the prepared lesson before publishing.'; end if;
  if new.kind='video' and new.video_path is null then raise exception 'Video missing.'; end if;
  foreach object_path in array array[new.media_path,new.video_path,new.cover_path] loop
   if object_path is not null and not exists(select 1 from storage.objects where bucket_id='lesson-media' and name=object_path) then raise exception 'Media upload incomplete.'; end if;
  end loop;
  if jsonb_typeof(new.tokens)<>'array' or jsonb_array_length(new.tokens)=0 then raise exception 'Tokens missing.'; end if;
  if new.kind<>'text' then
   if jsonb_typeof(new.timings)<>'array' or jsonb_array_length(new.timings)=0 then raise exception 'Word timings missing.'; end if;
   select char_length(new.text)+count(*) filter(where ascii(ch)>65535) into utf16_length from regexp_split_to_table(new.text,'') ch;
   for timing in select value from jsonb_array_elements(new.timings) loop
    if jsonb_typeof(timing)<>'array' or jsonb_array_length(timing)<>4 then raise exception 'Invalid word timing.'; end if;
    if (timing->>0)::numeric<0 or (timing->>1)::numeric<=(timing->>0)::numeric or (timing->>1)::numeric>utf16_length or (timing->>2)::numeric<0 or (timing->>3)::numeric<(timing->>2)::numeric then raise exception 'Invalid timing bounds.'; end if;
   end loop;
  end if;
 end if;
 return new;
end;
$$;
create trigger validate_publication before update on public.published_lessons for each row execute function public.validate_lesson_publication();

-- Explicit grants, independent of a project's default privileges.
revoke all on public.admins,public.learner_state,public.service_usage from anon,authenticated;
grant select on public.admins,public.learner_state to authenticated;
revoke all on public.published_lessons from anon,authenticated;
grant select on public.published_lessons to anon,authenticated;
grant insert,update,delete on public.published_lessons to authenticated;
