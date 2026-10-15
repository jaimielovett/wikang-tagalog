import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('a learner\'s own lesson audio is theirs alone, within their room',async()=>{
 const db=new PGlite();
 const learner='22222222-2222-2222-2222-222222222222',other='33333333-3333-3333-3333-333333333333';
 try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),name text,bucket_id text,metadata jsonb);alter table storage.objects enable row level security;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
 grant usage on schema public,auth,storage to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 grant select,insert,delete on storage.objects to anon,authenticated;
 insert into auth.users values('${learner}'),('${other}');`);
 await db.exec(await readFile('supabase/migrations/202610150001_learner_media.sql','utf8'));
 const bucket=(await db.query(`select public,file_size_limit from storage.buckets where id='learner-media'`)).rows[0];
 assert.equal(bucket.public,false);
 const as=async(role,id='')=>db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${id}',false);`);
 await as('authenticated',learner);
 await db.query(`insert into storage.objects(name,bucket_id,metadata) values('${learner}/1.m4a','learner-media','{"size":1000}')`);
 assert.equal((await db.query(`select name from storage.objects`)).rows.length,1);
 // no one else reads, adds to or empties a learner's folder
 await as('authenticated',other);
 assert.equal((await db.query(`select name from storage.objects`)).rows.length,0);
 await assert.rejects(db.query(`insert into storage.objects(name,bucket_id) values('${learner}/2.m4a','learner-media')`),/row-level security/);
 assert.equal((await db.query(`delete from storage.objects where name='${learner}/1.m4a' returning name`)).rows.length,0);
 await as('anon');
 assert.equal((await db.query(`select name from storage.objects`)).rows.length,0);
 // a full room takes nothing more
 await db.exec(`reset role;insert into storage.objects(name,bucket_id,metadata) values('${learner}/big.m4a','learner-media','{"size":2147483648}')`);
 await as('authenticated',learner);
 await assert.rejects(db.query(`insert into storage.objects(name,bucket_id,metadata) values('${learner}/3.m4a','learner-media','{"size":10}')`),/row-level security/);
 assert.equal((await db.query(`delete from storage.objects where name='${learner}/big.m4a' returning name`)).rows.length,1);
 await db.query(`insert into storage.objects(name,bucket_id,metadata) values('${learner}/3.m4a','learner-media','{"size":10}')`);
 }finally{await db.close();}
});
