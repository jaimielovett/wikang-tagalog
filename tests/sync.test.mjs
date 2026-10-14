import test from 'node:test';
import assert from 'node:assert/strict';
import {newSyncState,syncOnce,fingerprint} from '../src/lib/web/sync.ts';

/** The server's rule, as in push_learner_records: per record, the newest change wins; times never run ahead of the server. */
function fakeServer() {
 const rows=new Map();let tick=0;const pushes=[];
 return {rows,pushes,remote:{
  async push(batch){pushes.push(...batch);for(const r of batch){const t=Date.parse(r.updated_at);const old=rows.get(r.key);if(!old||Date.parse(old.updated_at)<t)rows.set(r.key,{key:r.key,data:r.data,updated_at:r.updated_at,server_at:new Date(Date.UTC(2026,9,14)+(++tick)*1000).toISOString()});}},
  async pull(since){return [...rows.values()].filter(r=>!since||r.server_at>since).sort((a,b)=>a.server_at.localeCompare(b.server_at));},
 }};
}
const db=()=>({settings:{},lessons:[],terms:{},activity:{},nextId:1,installed:[]});
const device=(name)=>({name,db:db(),state:newSyncState()});
const sync=(d,server,now)=>syncOnce(d.db,d.state,d.name,server.remote,now);
const lesson=(id,title)=>({id,lang:'tl',title,text:'May bahay.',collection:'',kind:'text',source:'',created_at:1});
const term=(status,at)=>({term:'bahay',status,translation:'house',note:'',lemma:'',context:'',updated_at:at});
const day=(words,secs)=>({day:'2026-10-14',lang:'tl',words_read:words,known_added:0,lingqs:0,listen_secs:0,learn_secs:secs,goal_met:false});

test('a second device receives lessons, words and settings, but never secrets',async()=>{
 const server=fakeServer();const a=device('a');const b=device('b');
 a.db.lessons.push(lesson(1,'Ang parola sa isla'));a.db.terms['tl|bahay']=term(4,1);a.db.settings.daily_goal='20';a.db.settings.gemini_key='private';
 await sync(a,server,1000);
 assert.equal(server.pushes.some(r=>r.key.includes('gemini')),false);
 assert.equal(await sync(b,server,2000),true,'the view should refresh');
 assert.deepEqual(b.db.lessons.map(l=>l.title),['Ang parola sa isla']);
 assert.equal(b.db.terms['tl|bahay'].status,4);assert.equal(b.db.settings.daily_goal,'20');assert.equal(b.db.settings.gemini_key,undefined);
 assert.equal(b.db.nextId,2,'new local ids never reuse a synced one');
 const before=server.pushes.length;await sync(b,server,3000);assert.equal(server.pushes.length,before,'nothing to send back');
});

test('the newest change to a record wins, wherever it was made, even offline',async()=>{
 const server=fakeServer();const a=device('a');const b=device('b');
 a.db.terms['tl|bahay']=term(1,1);await sync(a,server,1000);await sync(b,server,1100);
 a.db.terms['tl|bahay']=term(2,2);await sync(a,server,2000);
 b.db.terms['tl|bahay']=term(4,3);await sync(b,server,3000);
 await sync(a,server,3100);
 assert.equal(a.db.terms['tl|bahay'].status,4);assert.equal(b.db.terms['tl|bahay'].status,4);
 // b edits while offline at 3500; a edits later at 4000: a's newer edit wins on both
 b.db.terms['tl|bahay']=term(1,5);
 const offline={push:async()=>{throw new Error('offline');},pull:async()=>{throw new Error('offline');}};
 await assert.rejects(syncOnce(b.db,b.state,'b',offline,3500));
 a.db.terms['tl|bahay']=term(3,6);await sync(a,server,4000);
 await sync(b,server,5000);await sync(a,server,5100);
 assert.equal(b.db.terms['tl|bahay'].status,3);assert.equal(a.db.terms['tl|bahay'].status,3);
 // and an offline edit newer than everything else survives the return online
 b.db.settings.theme='dark';await assert.rejects(syncOnce(b.db,b.state,'b',offline,6000));
 a.db.settings.theme='light';await sync(a,server,5500);
 await sync(b,server,7000);await sync(a,server,7100);
 assert.equal(a.db.settings.theme,'dark');assert.equal(b.db.settings.theme,'dark');
});

test('deletions travel, changes undone before syncing are never sent, and playlists keep their ids',async()=>{
 const server=fakeServer();const a=device('a');const b=device('b');
 a.db.lessons.push(lesson(1,'Una'),lesson(2,'Ikalawa'));a.db.playlists=[{id:7,lang:'tl',name:'Practice',lessons:[1,2],current:null,created_at:1}];
 await sync(a,server,1000);await sync(b,server,1100);
 a.db.lessons=a.db.lessons.filter(l=>l.id!==1);a.db.playlists[0].lessons=[2];
 await sync(a,server,2000);await sync(b,server,2100);
 assert.deepEqual(b.db.lessons.map(l=>l.id),[2]);assert.deepEqual(b.db.playlists[0].lessons,[2]);
 const before=server.pushes.length;
 b.db.settings.daily_goal='30';delete b.db.settings.daily_goal;await sync(b,server,3000);
 assert.equal(server.pushes.length,before);
});

test('daily activity adds up across devices without counting anything twice',async()=>{
 const server=fakeServer();const a=device('a');const b=device('b');
 a.db.activity['2026-10-14|tl']=day(100,600);await sync(a,server,1000);
 b.db.activity['2026-10-14|tl']=day(50,300);await sync(b,server,1100);
 assert.equal(b.db.activity['2026-10-14|tl'].words_read,150);
 await sync(a,server,1200);assert.equal(a.db.activity['2026-10-14|tl'].words_read,150);assert.equal(a.db.activity['2026-10-14|tl'].learn_secs,900);
 // b reads 10 more words: shown as 160 everywhere, and a's own record is untouched
 b.db.activity['2026-10-14|tl'].words_read+=10;await sync(b,server,2000);await sync(a,server,2100);
 assert.equal(a.db.activity['2026-10-14|tl'].words_read,160);
 assert.equal(server.rows.get('activity:2026-10-14|tl:a').data.words_read,100);
 assert.equal(server.rows.get('activity:2026-10-14|tl:b').data.words_read,60);
 await sync(a,server,3000);await sync(b,server,3100);
 assert.equal(a.db.activity['2026-10-14|tl'].words_read,160);assert.equal(b.db.activity['2026-10-14|tl'].words_read,160);
});

test('fingerprints tell values apart and mark deletion with 0',()=>{
 assert.equal(fingerprint(null),0);assert.notEqual(fingerprint({a:1}),fingerprint({a:2}));assert.notEqual(fingerprint(''),0);
});

test('fingerprints ignore field order, and old sync states move to them without inventing changes',async()=>{
 const {upgradeFingerprints}=await import('../src/lib/web/sync.ts');
 assert.equal(fingerprint({a:1,b:{c:2,d:3}}),fingerprint({b:{d:3,c:2},a:1}));
 // a device that synced before the change: its shadow holds order-sensitive fingerprints
 const server=fakeServer();const a=device('a');
 a.db.terms['tl|bahay']=term(4,1);a.db.settings.daily_goal='20';await sync(a,server,1000);
 const legacy=(v)=>{let h1=0xdeadbeef,h2=0x41c6ce57;const s=JSON.stringify(v);for(let i=0;i<s.length;i++){const ch=s.charCodeAt(i);h1=Math.imul(h1^ch,2654435761);h2=Math.imul(h2^ch,1597334677);}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return 4294967296*(2097151&h2)+(h1>>>0)||1;};
 for(const k of Object.keys(a.state.shadow))a.state.shadow[k][0]=legacy(k.startsWith('term:')?a.db.terms['tl|bahay']:a.db.settings.daily_goal);
 delete a.state.fv;
 const before=server.pushes.length;await sync(a,server,2000);
 assert.equal(server.pushes.length,before,'nothing is re-sent after the switch');
 assert.equal(a.state.fv,2);
});
