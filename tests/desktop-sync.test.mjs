import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopRound,newDesktopState} from '../src/lib/desktop-syncmap.ts';
import {newSyncState,syncOnce} from '../src/lib/web/sync.ts';

/** The server's rule (push_learner_records): per record, the newest change wins. */
function fakeServer() {
 const rows=new Map();let tick=0;const pushes=[];
 return {rows,pushes,remote:{
  async push(batch){pushes.push(...batch);for(const r of batch){const t=Date.parse(r.updated_at);const old=rows.get(r.key);if(!old||Date.parse(old.updated_at)<t)rows.set(r.key,{key:r.key,data:r.data,updated_at:r.updated_at,server_at:new Date(Date.UTC(2026,9,14)+(++tick)*1000).toISOString()});}},
  async pull(since){return [...rows.values()].filter(r=>!since||r.server_at>since).sort((a,b)=>a.server_at.localeCompare(b.server_at));},
 }};
}
/** The desktop database as src-tauri/src/sync.rs reads and writes it (its own ids, its files kept). */
function fakeDesktop(start) {
 const d={settings:{},lessons:[],terms:{},activity:{},playlists:[],chats:[],next:1,...structuredClone(start)};
 d.next=Math.max(d.next,...d.lessons.map(l=>l.id+1),...d.playlists.map(p=>p.id+1),...d.chats.map(c=>c.id+1));
 return {d,
  export:()=>structuredClone({settings:d.settings,lessons:d.lessons,terms:d.terms,activity:d.activity,playlists:d.playlists,chats:d.chats}),
  async apply(changes){const created=[];
   for(const ch of changes){const v=ch.data;const local=/^\d+$/.test(ch.key)?Number(ch.key):null;
    if(ch.kind==='setting'){if(v==null)delete d.settings[ch.key];else d.settings[ch.key]=v;}
    else if(ch.kind==='term'){if(v==null)delete d.terms[ch.key];else d.terms[ch.key]=v;}
    else if(ch.kind==='activity'){if(v==null)delete d.activity[ch.key];else d.activity[ch.key]=v;}
    else{const list=ch.kind==='lesson'?d.lessons:ch.kind==='playlist'?d.playlists:d.chats;
     if(v==null){const i=list.findIndex(x=>x.id===local);if(i>=0)list.splice(i,1);continue;}
     const {id:_,...fields}=v;
     if(ch.kind==='playlist')fields.lessons=fields.lessons.filter(l=>d.lessons.some(x=>x.id===l));
     if(local!=null){const x=list.find(x=>x.id===local);
      // the account's copy without media leaves this computer's files in place (COALESCE)
      for(const f of ['media_path','video_path','cover_path','media_url'])if(ch.kind==='lesson'&&fields[f]==null)fields[f]=x[f];
      Object.assign(x,fields);}
     else{const id=d.next++;list.push({...fields,id});created.push({key:ch.key,id});}}}
   return created;}};
}
const lesson=(id,title,extra={})=>({id,lang:'tl',title,collection:'',kind:'text',source:'',text:`${title}.`,media_path:null,timings:null,video_path:null,hue:1,word_count:1,page:0,completed:false,position:0,anchor:0,duration:0,cover_path:null,timing_v:0,created_at:1,...extra});
const term=(status,at)=>({term:'bahay',status,translation:'house',note:'',lemma:'',context:'',updated_at:at});
const round=(desk,st,server,now)=>desktopRound(desk.export(),st,server.remote,(c)=>desk.apply(c),now);

test('a desktop lesson made from YouTube reaches the web, and the web\'s learning reaches the desktop',async()=>{
 const server=fakeServer();
 // the web already has the account: a lesson and a word marked known later than on the desktop
 const web={settings:{daily_goal:'20',user_name:'Jamie',last_lesson:'7'},lessons:[lesson(7,'Mula sa web')],terms:{'tl|bahay':term(4,2000)},activity:{},nextId:8,installed:[]};
 const webState=newSyncState();await syncOnce(web,webState,'web',server.remote,1000);
 // the desktop: a video transcribed from YouTube (its files on this computer), the same word learnt earlier
 const desk=fakeDesktop({settings:{daily_goal:'30',llm_model:'qwen',backup_dir:'C:/Backups',last_lesson:'1'},
  lessons:[lesson(1,'Adobong manok',{kind:'video',source:'https://www.youtube.com/watch?v=ninongry001',media_path:'C:/media/1.m4a',video_path:'C:/media/1.mp4',timings:'[[0,5,0,1]]',timing_v:2,media_url:'https://www.youtube.com/watch?v=ninongry001'})],
  terms:{'tl|bahay':term(2,1000)},playlists:[{id:1,lang:'tl',name:'Luto',lessons:[1],current:1,created_at:1}]});
 const st=newDesktopState('desk');
 assert.equal(await round(desk,st,server,3000),true);
 // the desktop now has the web's lesson, the newer word, and the account's settings
 assert.deepEqual(desk.d.lessons.map(l=>l.title).sort(),['Adobong manok','Mula sa web']);
 assert.equal(desk.d.terms['tl|bahay'].status,4);
 assert.equal(desk.d.settings.daily_goal,'20','the account\'s settings come first');
 assert.equal(desk.d.settings.llm_model,'qwen');assert.equal(desk.d.settings.last_lesson,'1','this computer\'s own settings stay its own');
 // the video lesson kept its files here, and travels with its YouTube address instead of them
 const video=desk.d.lessons.find(l=>l.title==='Adobong manok');
 assert.equal(video.media_path,'C:/media/1.m4a');assert.equal(video.video_path,'C:/media/1.mp4');
 const sent=[...server.rows.values()].find(r=>r.key.startsWith('lesson:')&&r.data?.title==='Adobong manok');
 assert.equal(sent.data.media_path,null);assert.equal(sent.data.video_path,null);
 assert.equal(sent.data.media_url,'https://www.youtube.com/watch?v=ninongry001');assert.equal(sent.data.timings,'[[0,5,0,1]]');
 assert.equal([...server.rows.keys()].some(k=>/llm_model|backup_dir|last_lesson/.test(k)&&server.rows.get(k).data!=='7'),false,'machine settings never leave');
 // the web sees the video lesson, in the playlist made on the desktop
 await syncOnce(web,webState,'web',server.remote,4000);
 const onWeb=web.lessons.find(l=>l.title==='Adobong manok');
 assert.ok(onWeb);assert.equal(onWeb.media_url,'https://www.youtube.com/watch?v=ninongry001');
 assert.deepEqual(web.playlists.find(p=>p.name==='Luto').lessons,[onWeb.id]);
 // nothing bounces back and forth afterwards
 const before=server.pushes.length;
 assert.equal(await round(desk,st,server,5000),false);await syncOnce(web,webState,'web',server.remote,5100);await round(desk,st,server,5200);
 assert.equal(server.pushes.length,before);
});

test('later changes travel both ways: new lessons, edits, deletions',async()=>{
 const server=fakeServer();
 const desk=fakeDesktop({lessons:[lesson(1,'Una'),lesson(2,'Ikalawa')]});
 const st=newDesktopState('desk');await round(desk,st,server,1000);
 const web={settings:{},lessons:[],terms:{},activity:{},nextId:1,installed:[]};const ws=newSyncState();
 await syncOnce(web,ws,'web',server.remote,1100);
 assert.equal(web.lessons.length,2);
 // the web finishes one lesson and deletes the other; the desktop learns a word
 web.lessons.find(l=>l.title==='Una').completed=true;
 web.lessons=web.lessons.filter(l=>l.title!=='Ikalawa');
 await syncOnce(web,ws,'web',server.remote,2000);
 desk.d.terms['tl|araw']={term:'araw',status:4,translation:'day',note:'',lemma:'',context:'',updated_at:2100};
 await round(desk,st,server,2200);
 assert.deepEqual(desk.d.lessons.map(l=>[l.title,l.completed]),[['Una',true]]);
 await syncOnce(web,ws,'web',server.remote,2300);
 assert.equal(web.terms['tl|araw'].status,4);
 // a lesson deleted on the desktop leaves the web too
 desk.d.lessons=[];await round(desk,st,server,3000);await syncOnce(web,ws,'web',server.remote,3100);
 assert.equal(web.lessons.length,0);
});
