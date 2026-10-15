import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {DEVICE_SETTING} from '../src/lib/desktop-syncmap.ts';

test('keys stay on the computer: the account deletes the ones it had and ignores any sent later',async()=>{
 const db=new PGlite();
 const learner='22222222-2222-2222-2222-222222222222';
 try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),name text,bucket_id text);alter table storage.objects enable row level security;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
 grant usage on schema public,auth,storage to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated;
 insert into auth.users values('${learner}');`);
 for(const f of ['202610120001_wikang_tagalog','202610140002_learner_records','202610140003_app_requirements'])await db.exec(await readFile(`supabase/migrations/${f}.sql`,'utf8'));
 const as=async(role,id='')=>db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${id}',false);`);
 const push=(rows)=>db.query('select public.push_learner_records($1) as n',[JSON.stringify(rows)]).then(r=>r.rows[0].n);
 const keys=async()=>(await db.query('select key from public.learner_records order by key')).rows.map(r=>r.key);
 const at='2026-10-15T10:00:00Z';
 // before: an app sent its keys along with the learning
 await as('authenticated',learner);
 await push([{key:'setting:google_tts_key',data:'AIza-secret',updated_at:at},{key:'setting:gemini_key',data:'g-secret',updated_at:at},{key:'setting:lingq_key',data:'l-secret',updated_at:at},
  {key:'setting:daily_goal',data:'20',updated_at:at},{key:'term:tl|bahay',data:{status:4},updated_at:at}]);
 assert.equal((await keys()).length,5);
 await db.exec('reset role;'+await readFile('supabase/migrations/202610150002_keys_stay_on_device.sql','utf8'));
 await as('authenticated',learner);
 assert.deepEqual(await keys(),['setting:daily_goal','term:tl|bahay'],'the keys already kept are gone');
 // after: keys are ignored, everything else still syncs
 assert.equal(await push([{key:'setting:google_tts_key',data:'AIza-again',updated_at:'2026-10-15T11:00:00Z'},{key:'setting:online_key_openai',data:'sk-x',updated_at:'2026-10-15T11:00:00Z'},
  {key:'setting:refresh_token',data:'t',updated_at:'2026-10-15T11:00:00Z'},{key:'setting:theme',data:'dark',updated_at:'2026-10-15T11:00:00Z'}]),1);
 assert.deepEqual(await keys(),['setting:daily_goal','setting:theme','term:tl|bahay']);
 }finally{await db.close();}
});

test('the desktop never sends a key, and never takes one from the account',()=>{
 for(const k of ['google_tts_key','gemini_key','lingq_key','online_key_openai','online_provider','some_token','api_secret','password'])assert.ok(DEVICE_SETTING.test(k),k);
 for(const k of ['daily_goal','theme','auto_pronounce','tap_marks_learning','user_name','keyboard_layout'])assert.ok(!DEVICE_SETTING.test(k),k);
});
