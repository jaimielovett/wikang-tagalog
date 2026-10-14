import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('learning records: newest change wins per record, accounts stay private, old apps cannot overwrite',async()=>{
 const db=new PGlite();
 const learner='22222222-2222-2222-2222-222222222222',other='33333333-3333-3333-3333-333333333333';
 try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),name text,bucket_id text);alter table storage.objects enable row level security;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
 grant usage on schema public,auth,storage to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated;
 insert into auth.users values('${learner}'),('${other}');`);
 for(const f of ['202610120001_wikang_tagalog','202610140001_discover_sources','202610140002_learner_records','202610140003_app_requirements','202610140004_discover_refresh_where'])await db.exec(await readFile(`supabase/migrations/${f}.sql`,'utf8'));
 const as=async(role,id='')=>db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${id}',false);`);
 const push=(rows)=>db.query('select public.push_learner_records($1) as n',[JSON.stringify(rows)]).then(r=>r.rows[0].n);
 const row=async(key)=>(await db.query('select data,updated_at from public.learner_records where key=$1',[key])).rows[0];

 await as('authenticated',learner);
 // an old app saved the whole document before; it still can until records exist
 await db.query(`select public.save_learner_state(0,'{"terms":{}}')`);
 assert.equal(await push([{key:'term:tl|bahay',data:{status:2},updated_at:'2026-10-14T10:00:00Z',version:1},{key:'setting:daily_goal',data:'20',updated_at:'2026-10-14T10:00:00Z'}]),2);
 assert.equal(await push([{key:'term:tl|bahay',data:{status:1},updated_at:'2026-10-14T09:00:00Z'}]),0,'an older change loses');
 assert.equal((await row('term:tl|bahay')).data.status,2);
 assert.equal(await push([{key:'term:tl|bahay',data:{status:4},updated_at:'2026-10-14T11:00:00Z'}]),1,'a newer change wins');
 assert.equal((await row('term:tl|bahay')).data.status,4);
 await push([{key:'setting:theme',data:'dark',updated_at:'2999-01-01T00:00:00Z'}]);
 assert.ok(new Date((await row('setting:theme')).updated_at)<new Date('2100-01-01'),'a clock running ahead cannot win forever');
 assert.equal(await push([{key:'setting:daily_goal',data:null,updated_at:'2026-10-14T12:00:00Z'}]),1);
 assert.equal((await row('setting:daily_goal')).data,null,'deletions are kept so every device hears of them');
 await assert.rejects(push([{key:'admin:x',data:1,updated_at:'2026-10-14T12:00:00Z'}]),/invalid_record/);
 await assert.rejects(push([{key:'term:x',data:'x'.repeat(10000001),updated_at:'2026-10-14T12:00:00Z'}]),/record_too_large/);
 await assert.rejects(db.query(`insert into public.learner_records(user_id,key,data,updated_at) values('${learner}','term:x','1',now())`),/permission denied/);
 await assert.rejects(db.query(`select public.save_learner_state(1,'{"terms":{}}')`),/sync_conflict/,'old apps are turned away once records exist');
 // raising the minimum format turns older apps away, and everyone can read the requirements
 await db.exec('reset role');await db.exec("update public.app_requirements set min_record_version=2,min_desktop_version='0.2.0'");
 await as('authenticated',learner);
 await assert.rejects(push([{key:'setting:font',data:'serif',updated_at:'2026-10-14T13:00:00Z',version:1}]),/update_required/);
 assert.equal(await push([{key:'setting:font',data:'serif',updated_at:'2026-10-14T13:00:00Z',version:2}]),1);
 await as('anon');assert.equal((await db.query('select min_desktop_version from public.app_requirements')).rows[0].min_desktop_version,'0.2.0');
 await assert.rejects(db.query("update public.app_requirements set min_record_version=1"),/permission denied/);
 await as('authenticated',learner);
 await db.exec('reset role');const used=(await db.query(`select bytes from public.learner_usage where user_id='${learner}'`)).rows[0].bytes;
 assert.ok(Number(used)>0);

 await as('authenticated',other);
 assert.equal((await db.query('select * from public.learner_records')).rows.length,0,'records are private');
 await as('anon');
 await assert.rejects(db.query('select * from public.learner_records'),/permission denied/);
 await assert.rejects(db.query(`select public.push_learner_records('[]')`),/permission denied|authentication_required/);
 }finally{await db.close();}
});
