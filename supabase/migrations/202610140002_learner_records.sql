-- Item-by-item sync: each setting, lesson, word, playlist, chat and device-day of activity is
-- its own record, and the newest change wins per record. Replaces saving learning as one
-- document (learner_state), which is kept, read once to migrate each account.
-- Run after 202610140001_discover_sources.sql.

create table public.learner_records (
 user_id uuid not null references auth.users(id) on delete cascade,
 key text not null check(length(key) between 3 and 300),
 -- null: deleted (kept, so the deletion reaches every device)
 data jsonb,
 -- when the change was made (never later than the server's clock)
 updated_at timestamptz not null,
 -- format of `data`; lets the server turn away an outdated app
 version smallint not null default 1 check(version>=1),
 -- when the server stored it: devices pull what changed since their last pull
 server_at timestamptz not null default clock_timestamp(),
 primary key(user_id,key)
);
alter table public.learner_records enable row level security;
create policy "Read own records" on public.learner_records for select to authenticated using(user_id=auth.uid());
create index learner_records_changes on public.learner_records(user_id,server_at);

-- Bytes each account stores, so one account cannot fill the database.
create table public.learner_usage (user_id uuid primary key references auth.users(id) on delete cascade,bytes bigint not null default 0);
alter table public.learner_usage enable row level security;

create function public.push_learner_records(records jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare item jsonb; record_key text; old_size bigint; new_size bigint; changed integer:=0; delta bigint:=0; total bigint;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 if jsonb_typeof(records)<>'array' or jsonb_array_length(records)>1000 then raise exception 'invalid_records'; end if;
 for item in select value from jsonb_array_elements(records) loop
  record_key:=item->>'key';
  if record_key is null or length(record_key) not between 3 and 300 or record_key !~ '^(setting|lesson|term|playlist|chat|activity):'
   or jsonb_typeof(item->'updated_at')<>'string' then raise exception 'invalid_record'; end if;
  new_size:=case when item->'data' is null or jsonb_typeof(item->'data')='null' then 0 else octet_length((item->'data')::text) end;
  if new_size>10000000 then raise exception 'record_too_large'; end if;
  select coalesce(octet_length(data::text),0) into old_size from public.learner_records where user_id=auth.uid() and key=record_key;
  insert into public.learner_records(user_id,key,data,updated_at,version,server_at)
  values(auth.uid(),record_key,case when new_size=0 then null else item->'data' end,
   least((item->>'updated_at')::timestamptz,clock_timestamp()),coalesce((item->>'version')::smallint,1),clock_timestamp())
  on conflict(user_id,key) do update set data=excluded.data,updated_at=excluded.updated_at,version=excluded.version,server_at=excluded.server_at
   where public.learner_records.updated_at<excluded.updated_at;
  if found then changed:=changed+1;delta:=delta+new_size-coalesce(old_size,0); end if;
 end loop;
 insert into public.learner_usage values(auth.uid(),greatest(delta,0)) on conflict(user_id) do update set bytes=greatest(public.learner_usage.bytes+delta,0) returning bytes into total;
 if total>250000000 then raise exception 'storage_full'; end if;
 return changed;
end;
$$;
revoke all on function public.push_learner_records(jsonb) from public;
grant execute on function public.push_learner_records(jsonb) to authenticated;

-- Once an account syncs item by item, an old app still open somewhere may not save the whole document over it.
create or replace function public.save_learner_state(expected_revision bigint,new_data jsonb) returns bigint
 language plpgsql security definer set search_path='' as $$
declare next_revision bigint;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 if exists(select 1 from public.learner_records where user_id=auth.uid()) then raise exception 'sync_conflict: this account now syncs item by item; reload the app'; end if;
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

revoke all on public.learner_records,public.learner_usage from anon,authenticated;
grant select on public.learner_records to authenticated;
