import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const secret='a-long-test-secret-for-the-discover-cache';
test('Discover sources: admins curate, the cache only takes signed results, learners only read',async()=>{
 const db=new PGlite();
 const admin='11111111-1111-1111-1111-111111111111',learner='22222222-2222-2222-2222-222222222222';
 try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),name text,bucket_id text);alter table storage.objects enable row level security;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
 grant usage on schema public,auth,storage to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated;
 insert into auth.users values('${admin}'),('${learner}');`);
 await db.exec(await readFile('supabase/migrations/202610120001_wikang_tagalog.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/202610140001_discover_sources.sql','utf8'));
 await db.exec(`insert into public.admins values('${admin}');update public.discover_refresh set secret_hash=encode(sha256(convert_to('${secret}','UTF8')),'hex');`);
 const as=async(role,id='')=>db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${id}',false);`);
 const item=(id,extra={})=>({id:id.repeat(32).slice(0,32),kind:'text',title:'Balita ngayon',url:'https://example.org/a',page:'https://example.org/a',image:'',summary:'',duration:0,published:Math.floor(Date.now()/1000),lo:3,hi:5,...extra});

 await as('anon');
 assert.equal((await db.query('select * from public.discover_sources')).rows.length,10,'everyone sees the default sources');
 await assert.rejects(db.query(`select public.discover_begin_refresh('wrong-secret-that-is-long-enough',true)`),/refresh_not_allowed/);
 await assert.rejects(db.query(`select public.discover_finish('wrong-secret-that-is-long-enough','[]')`),/refresh_not_allowed/);
 await assert.rejects(db.query(`insert into public.discover_items(id,source_id,kind,title,url,lo,hi) values('${'a'.repeat(32)}','tl-bandera','text','x','https://x.org',1,1)`),/permission denied/);

 await as('authenticated',learner);
 await assert.rejects(db.query(`insert into public.discover_sources(id,name,kind,url) values('mine','Mine','articles','https://example.org/feed')`));
 assert.equal((await db.query(`update public.discover_sources set enabled=false where id='tl-bandera' returning id`)).rows.length,0,'learners cannot switch sources off for everyone');

 await as('authenticated',admin);
 await db.query(`insert into public.discover_sources(id,name,kind,url,shelf,lo,hi) values('tl-test','Test','articles','https://example.org/feed','news',3,5)`);
 await assert.rejects(db.query(`insert into public.discover_sources(id,name,kind,url) values('tl-bad','Bad','youtube','https://youtube.com/@bad')`),/check/);
 await assert.rejects(db.query(`update public.discover_sources set item_count=99 where id='tl-test'`),/permission denied/,'fetch status is the server\'s');

 // the server: a signed refresh stores valid items and skips invalid ones
 await as('anon');
 const sources=(await db.query(`select public.discover_begin_refresh('${secret}',true) as s`)).rows[0].s;
 assert.equal(sources.length,11);
 assert.equal((await db.query(`select public.discover_begin_refresh('${secret}',true) as s`)).rows[0].s,null,'never two refreshes at once');
 const results=[{source_id:'tl-test',items:[item('a'),item('b',{url:'http://insecure.example.org'}),item('c',{title:''})]},{source_id:'tl-bandera',items:[],error:'The feed answered 500.'},{source_id:'not-a-source',items:[item('d')]}];
 await db.query(`select public.discover_finish('${secret}',$1)`,[JSON.stringify(results)]);
 assert.deepEqual((await db.query('select id from public.discover_items')).rows.map(r=>r.id),['a'.repeat(32)]);
 assert.equal((await db.query(`select public.discover_begin_refresh('${secret}',false) as s`)).rows[0].s,null,'refreshed recently');
 const status=(await db.query('select public.discover_status() as s')).rows[0].s;
 assert.ok(status.last_refresh_at);assert.equal(status.refreshing,false);

 await as('authenticated',admin);
 const health=(await db.query(`select id,item_count,last_error from public.discover_sources where id in('tl-test','tl-bandera') order by id`)).rows;
 assert.deepEqual(health.map(r=>[r.id,r.item_count,r.last_error]),[['tl-bandera',0,'The feed answered 500.'],['tl-test',1,null]]);
 // switching a source off hides its items from everyone; retiring hides the source too
 await db.query(`update public.discover_sources set enabled=false where id='tl-test'`);
 await as('anon');assert.equal((await db.query('select * from public.discover_items')).rows.length,0);
 await as('authenticated',admin);await db.query(`update public.discover_sources set retired_at=now() where id='tl-test'`);
 await as('authenticated',learner);assert.equal((await db.query(`select * from public.discover_sources where id='tl-test'`)).rows.length,0);
 await as('authenticated',admin);assert.equal((await db.query(`select * from public.discover_sources where id='tl-test'`)).rows.length,1,'admins still see retired sources');
 }finally{await db.close();}
});
