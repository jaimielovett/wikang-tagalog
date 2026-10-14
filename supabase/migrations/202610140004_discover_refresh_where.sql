-- Supabase refuses UPDATE without WHERE (pg_safeupdate), even inside functions called over the API:
-- the one-row discover_refresh table is updated "where id" (its only row). Same functions otherwise.
-- Run after 202610140003_app_requirements.sql.

create or replace function public.discover_begin_refresh(secret text,force boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare state public.discover_refresh;
begin
 perform public.discover_check_secret(secret);
 select * into state from public.discover_refresh where id for update;
 if state.refreshing_since is not null and state.refreshing_since>now()-interval '10 minutes' then return null; end if;
 if not force and state.last_refresh_at is not null and state.last_refresh_at>now()-interval '3 hours' then return null; end if;
 update public.discover_refresh set refreshing_since=now() where id;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'url',url,'shelf',shelf,'lo',lo,'hi',hi,'grade_titles',grade_titles))
  from public.discover_sources where enabled and retired_at is null),'[]'::jsonb);
end;
$$;

create or replace function public.discover_finish(secret text,results jsonb) returns void language plpgsql security definer set search_path='' as $$
declare result jsonb; item jsonb;
begin
 perform public.discover_check_secret(secret);
 if jsonb_typeof(results)<>'array' or jsonb_array_length(results)>200 then raise exception 'invalid_results'; end if;
 for result in select value from jsonb_array_elements(results) loop
  if not exists(select 1 from public.discover_sources where id=result->>'source_id') then continue; end if;
  if jsonb_typeof(result->'items')='array' then
   for item in select value from jsonb_array_elements(result->'items') limit 40 loop
    begin
     insert into public.discover_items(id,source_id,kind,title,url,page,image,summary,duration,published_at,lo,hi)
     values(item->>'id',result->>'source_id',item->>'kind',item->>'title',item->>'url',coalesce(item->>'page',''),coalesce(item->>'image',''),
      left(coalesce(item->>'summary',''),400),greatest(coalesce((item->>'duration')::double precision,0),0),
      case when coalesce((item->>'published')::bigint,0)>0 then to_timestamp((item->>'published')::bigint) end,
      (item->>'lo')::integer,(item->>'hi')::integer)
     on conflict(id) do update set title=excluded.title,url=excluded.url,page=excluded.page,image=excluded.image,summary=excluded.summary,
      duration=excluded.duration,published_at=excluded.published_at,lo=excluded.lo,hi=excluded.hi;
    exception when others then null;
    end;
   end loop;
  end if;
  update public.discover_sources set last_fetched_at=now(),last_error=nullif(left(coalesce(result->>'error',''),300),''),
   item_count=(select count(*) from public.discover_items where source_id=result->>'source_id')
  where id=result->>'source_id';
 end loop;
 delete from public.discover_items where coalesce(published_at,fetched_at)<now()-interval '30 days';
 update public.discover_refresh set last_refresh_at=now(),refreshing_since=null where id;
end;
$$;
