-- The oldest app versions that may still sync. Raise them (in the SQL editor) when a new
-- release changes how learning is stored: older apps are then asked to update instead of
-- writing data in a format the new ones no longer expect.
-- Run after 202610140002_learner_records.sql.

create table public.app_requirements (
 id boolean primary key default true check(id),
 -- oldest record format accepted (src/lib/web/sync.ts RECORD_VERSION)
 min_record_version smallint not null default 1 check(min_record_version>=1),
 -- oldest desktop app that may run (src-tauri/tauri.conf.json "version"), e.g. '0.2.0'
 min_desktop_version text not null default '0.0.0' check(min_desktop_version ~ '^\d+\.\d+\.\d+$')
);
alter table public.app_requirements enable row level security;
create policy "Everyone reads the requirements" on public.app_requirements for select to anon,authenticated using(true);
insert into public.app_requirements(id) values(true);
revoke all on public.app_requirements from anon,authenticated;
grant select on public.app_requirements to anon,authenticated;

-- Records in a format older than the minimum are refused: the app is told to update.
create or replace function public.push_learner_records(records jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare item jsonb; record_key text; old_size bigint; new_size bigint; changed integer:=0; delta bigint:=0; total bigint; oldest smallint;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 if jsonb_typeof(records)<>'array' or jsonb_array_length(records)>1000 then raise exception 'invalid_records'; end if;
 select min_record_version into oldest from public.app_requirements;
 for item in select value from jsonb_array_elements(records) loop
  record_key:=item->>'key';
  if record_key is null or length(record_key) not between 3 and 300 or record_key !~ '^(setting|lesson|term|playlist|chat|activity):'
   or jsonb_typeof(item->'updated_at')<>'string' then raise exception 'invalid_record'; end if;
  if coalesce((item->>'version')::smallint,1)<coalesce(oldest,1) then raise exception 'update_required'; end if;
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
