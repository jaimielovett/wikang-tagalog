import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
// Supabase refuses UPDATE and DELETE without WHERE over its API (pg_safeupdate), even inside
// functions; the local test database does not, so the migrations are checked here.
// The two statements of 202610140001 are replaced by 202610140004.
const replaced=new Set(['202610140001_discover_sources.sql:update public.discover_refresh set refreshing_since=now()','202610140001_discover_sources.sql:update public.discover_refresh set last_refresh_at=now(),refreshing_since=null']);
test('every UPDATE and DELETE in the migrations has a WHERE',async()=>{
 const bad=[];
 for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) {
  const sql=(await readFile(`supabase/migrations/${file}`,'utf8')).replace(/--.*$/gm,'');
  for(const [statement] of sql.matchAll(/(update|delete\s+from)\s+public\.\w+[^;]*;/gi)) {
   if(/on\s+conflict/i.test(statement)||/where/i.test(statement))continue;
   const head=statement.replace(/\s+/g,' ').replace(/;$/,'').trim();
   if(!replaced.has(`${file}:${head}`))bad.push(`${file}: ${head}`);
  }
 }
 assert.deepEqual(bad,[]);
});
