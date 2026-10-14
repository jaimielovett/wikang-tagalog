-- Discover: admin-curated default sources, read by the server into a shared cache.
-- Run after 202610120001_wikang_tagalog.sql. Still no service-role key: the server
-- writes the cache only through functions that check DISCOVER_SECRET.

create table public.discover_sources (
 id text primary key check(id ~ '^[a-z0-9-]{2,60}$'),
 name text not null check(length(trim(name)) between 1 and 120),
 kind text not null check(kind in('youtube','podcast','articles')),
 -- a YouTube channel ID (UC…), or the HTTPS address of a podcast or article feed
 url text not null check((kind='youtube' and url ~ '^UC[A-Za-z0-9_-]{22}$') or (kind<>'youtube' and url ~ '^https://' and length(url)<=2000)),
 shelf text not null default 'learn' check(shelf in('learn','news','culture','music')),
 lo integer not null default 1 check(lo between 1 and 5), hi integer not null default 5 check(hi between 1 and 5 and hi>=lo),
 -- learner channels announce levels in their titles (« for Beginners », « A2 »)
 grade_titles boolean not null default false,
 enabled boolean not null default true,
 created_at timestamptz not null default now(),
 -- retired sources are hidden, never deleted: learners' settings may still name them
 retired_at timestamptz,
 last_fetched_at timestamptz, last_error text, item_count integer not null default 0
);
alter table public.discover_sources enable row level security;
create policy "Everyone sees current sources, admins all" on public.discover_sources for select to anon,authenticated using(retired_at is null or public.is_admin());
create policy "Admins add sources" on public.discover_sources for insert to authenticated with check(public.is_admin());
create policy "Admins edit sources" on public.discover_sources for update to authenticated using(public.is_admin()) with check(public.is_admin());

-- Titles, summaries, images and links only: never an article's full text.
create table public.discover_items (
 id text primary key check(id ~ '^[0-9a-f]{32}$'),
 source_id text not null references public.discover_sources(id),
 kind text not null check(kind in('video','audio','text')),
 title text not null check(length(trim(title)) between 1 and 300),
 url text not null check(url ~ '^https://' and length(url)<=2000),
 page text not null default '' check(page='' or (page ~ '^https://' and length(page)<=2000)),
 image text not null default '' check(image='' or (image ~ '^https://' and length(image)<=2000)),
 summary text not null default '' check(length(summary)<=400),
 duration double precision not null default 0 check(duration>=0),
 published_at timestamptz,
 lo integer not null check(lo between 1 and 5), hi integer not null check(hi between 1 and 5 and hi>=lo),
 fetched_at timestamptz not null default now()
);
alter table public.discover_items enable row level security;
create policy "Items of enabled sources" on public.discover_items for select to anon,authenticated using(
 exists(select 1 from public.discover_sources s where s.id=source_id and s.enabled and s.retired_at is null)
);
create index discover_items_recent on public.discover_items(published_at desc nulls last);

-- One row: when the cache was last read, whether a read is running, and the secret's hash.
-- Set the secret once in the SQL editor (the same value as DISCOVER_SECRET on the server):
-- update public.discover_refresh set secret_hash=encode(sha256(convert_to('YOUR_SECRET','UTF8')),'hex');
create table public.discover_refresh (
 id boolean primary key default true check(id),
 secret_hash text, last_refresh_at timestamptz, refreshing_since timestamptz
);
alter table public.discover_refresh enable row level security;
insert into public.discover_refresh(id) values(true);

create function public.discover_check_secret(secret text) returns void language plpgsql stable security definer set search_path='' as $$
begin
 if secret is null or length(secret)<24 or not exists(
  select 1 from public.discover_refresh where secret_hash is not null and secret_hash=encode(sha256(convert_to(secret,'UTF8')),'hex')
 ) then raise exception 'refresh_not_allowed'; end if;
end;
$$;
revoke all on function public.discover_check_secret(text) from public;

-- Starts a refresh and returns the sources to read, or null if one ran recently (3 h) or is running (10 min).
create function public.discover_begin_refresh(secret text,force boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare state public.discover_refresh;
begin
 perform public.discover_check_secret(secret);
 select * into state from public.discover_refresh for update;
 if state.refreshing_since is not null and state.refreshing_since>now()-interval '10 minutes' then return null; end if;
 if not force and state.last_refresh_at is not null and state.last_refresh_at>now()-interval '3 hours' then return null; end if;
 update public.discover_refresh set refreshing_since=now();
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'url',url,'shelf',shelf,'lo',lo,'hi',hi,'grade_titles',grade_titles))
  from public.discover_sources where enabled and retired_at is null),'[]'::jsonb);
end;
$$;

-- Stores what was read: one entry per source ({source_id, items, error}). An invalid item is skipped, never the batch.
create function public.discover_finish(secret text,results jsonb) returns void language plpgsql security definer set search_path='' as $$
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
 update public.discover_refresh set last_refresh_at=now(),refreshing_since=null;
end;
$$;

-- What the app shows: "Updated at…", and whether the cache is due for a refresh.
create function public.discover_status() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('last_refresh_at',last_refresh_at,'refreshing',refreshing_since is not null and refreshing_since>now()-interval '10 minutes')
 from public.discover_refresh;
$$;

revoke all on function public.discover_begin_refresh(text,boolean),public.discover_finish(text,jsonb),public.discover_status() from public;
grant execute on function public.discover_begin_refresh(text,boolean),public.discover_finish(text,jsonb),public.discover_status() to anon,authenticated;

-- Explicit grants: admins edit only a source's description, never its fetch status.
revoke all on public.discover_sources,public.discover_items,public.discover_refresh from anon,authenticated;
grant select on public.discover_sources,public.discover_items to anon,authenticated;
grant insert(id,name,kind,url,shelf,lo,hi,grade_titles,enabled) on public.discover_sources to authenticated;
grant update(name,kind,url,shelf,lo,hi,grade_titles,enabled,retired_at) on public.discover_sources to authenticated;

-- Lumen's Tagalog sources that answer, plus Bandera (Inquirer's main feed is mostly English).
insert into public.discover_sources(id,name,kind,url,shelf,lo,hi,grade_titles) values
 ('tl-language-crush','Language Crush Tagalog','youtube','UCRzEyp4XtyTpGhdEuriB9iQ','learn',1,3,true),
 ('tl-another-chui','Another Chui Show PH','youtube','UC9x3qzD2uxGz--sBaSMhMjg','learn',2,4,true),
 ('tl-peenoise','Peenoise Plays','youtube','UC7TrbfuqtaqJyvji22UZIYw','learn',2,4,true),
 ('tl-mary-bautista','Mary Bautista','youtube','UCst-F1upPxpie6i_jA6vpRw','learn',2,4,true),
 ('tl-rec-create','Rec.Create','youtube','UCpZdK-V4x1b2TFzFBKwGztw','learn',2,4,true),
 ('tl-chef-jp-anglo','Chef JP Anglo','youtube','UCm37QmpEveOoeKfUvp8bcvA','learn',2,4,true),
 ('tl-astig-vegan','Astig Vegan','youtube','UCQiTYiCryLW0RoDyQh6aQ7w','learn',2,4,true),
 ('tl-chui-show','The Chui Show','youtube','UCJX9p4c81NoZ4_TFME-yY6g','learn',2,4,true),
 ('tl-ninong-ry','Ninong Ry','youtube','UCvQrjgLj841wiQAKDgtKFOw','learn',2,4,true),
 ('tl-bandera','Bandera','articles','https://bandera.inquirer.net/feed','news',3,5,false);
