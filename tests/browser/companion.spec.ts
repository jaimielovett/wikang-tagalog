import {test,expect,type Page} from '@playwright/test';
import {fakeAccount} from './cloud';

/**
 * The desktop companion in a browser: Tauri's bridge stands in for the desktop (its database of
 * lessons waiting to leave, and the transcription of a file or a YouTube link), and the account's
 * Supabase project is the test stand-in (tests/browser/cloud.ts).
 */
async function asDesktop(page:Page) {
 await page.addInitScript(()=>{
  const lessons:any[]=[];let next=1;const calls:string[]=[];
  const lesson=(extra:any)=>({id:next++,lang:'tl',collection:'',text:'Magandang araw po. Kumusta kayo?',timings:'[[0,9,0,0.6],[10,14,0.6,1],[15,17,1,1.2],[19,26,1.3,1.8],[27,32,1.8,2.2]]',
   video_path:null,hue:4,word_count:5,duration:2.4,timing_v:2,created_at:1760000000,media_url:null,...extra});
  const answers:Record<string,(a:any)=>any>={
   app_info:()=>({version:'0.1.2',data_dir:'C:/data',platform:'windows',ytdlp:true,transcriber:true,dict_langs:['tl']}),
   settings_get:()=>JSON.parse(localStorage.getItem('desk-settings')||'{}'),
   settings_set:(a)=>{const s=JSON.parse(localStorage.getItem('desk-settings')||'{}');s[a.key]=a.value;localStorage.setItem('desk-settings',JSON.stringify(s));},
   models_list:()=>[{id:'whisper-turbo',kind:'asr',name:'Whisper',detail:'',size:1,url:'',file:'',ram_gb:1,installed:true,active:true,downloading:false}],
   'plugin:dialog|open':()=>['C:/Users/me/Recordings/kuwento.mp3'],
   import_media:(a)=>{const l=lesson({title:'kuwento',kind:'audio',source:a.path,media_path:'C:/data/media/1.m4a'});lessons.push(l);return l.id;},
   link_probe:(a)=>({url:a.url,title:'Adobong manok',site:'YouTube',image:'',html:'',list:false,via:'',note:'',
    media:[{url:a.url,title:'Adobong manok',duration:300,video:true,direct:false,image:'',date:'',page:a.url,collection:''}]}),
   import_link:(a)=>{const l=lesson({title:a.item.title,kind:'video',source:a.item.page,media_path:'C:/data/media/2.m4a',video_path:'C:/data/media/2.mp4',media_url:a.item.url});lessons.push(l);return l.id;},
   outbox_lessons:()=>lessons,
   read_file:()=>new Uint8Array(2048).buffer,
   lessons_delete:(a)=>{for(const id of a.ids){const i=lessons.findIndex(l=>l.id===id);if(i>=0)lessons.splice(i,1);}},
  };
  (window as any).__desk={lessons,calls};
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  (window as any).__TAURI_INTERNALS__={
   invoke:async(cmd:string,args:any)=>{calls.push(cmd);const f=answers[cmd];if(f)return f(args);return cmd.endsWith('_list')||cmd.startsWith('terms')?[]:null;},
   transformCallback:(cb:any)=>{const id=Math.floor(Math.random()*1e9);(window as any)[`_${id}`]=cb;return id;},
   convertFileSrc:(p:string)=>p,
   metadata:{currentWindow:{label:'main'},currentWebview:{label:'main',windowLabel:'main'}},
  };
 });
}

test('the desktop companion signs in, imports, and every lesson lands in the web library',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await asDesktop(page);
 const account=fakeAccount();await account.attach(page);
 const uploads:{path:string;type:string|null;size:number}[]=[];
 await page.route('https://wikang-test.supabase.co/storage/v1/object/learner-media/**',async route=>{
  const path=new URL(route.request().url()).pathname.replace('/storage/v1/object/learner-media/','');
  // supabase-js sends the file as a form: its type is the part's own
  const body=route.request().postDataBuffer()?.toString('latin1') ?? '';
  uploads.push({path,type:/Content-Type: ((?:audio|video)\/[\w.+-]+)/i.exec(body)?.[1] ?? null,size:body.length});
  await route.fulfill({json:{Key:`learner-media/${path}`,Id:'1'},headers:{'Access-Control-Allow-Origin':'*'}});
 });
 await page.goto('/');
 // signing in only: accounts are made on the website, and there is no welcome
 await expect(page.getByRole('heading',{name:'Wikang Tagalog',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Create one on wikangtagalog.com'})).toBeVisible();
 await expect(page.getByText('Continue as a guest')).toHaveCount(0);
 await page.screenshot({path:'outputs/companion-signin.png'});
 await page.getByLabel('Email').fill('learner@example.org');await page.getByLabel('Password').fill('correct horse');
 await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'Sign in',exact:true}).click()]);
 // signed in: the import screen, and nothing else of the app
 await expect(page.getByRole('heading',{name:'Import',exact:true})).toBeVisible();
 await expect(page.getByText('learner@example.org')).toBeVisible();
 await expect(page.locator('.sidebar')).toHaveCount(0);
 await expect(page.getByRole('tab',{name:/Podcast/})).toHaveCount(0);
 await page.screenshot({path:'outputs/companion-import.png'});

 // a recording from the computer: transcribed here, its sound kept privately in the account
 await page.getByRole('tab',{name:/Audio, video/}).click();
 await page.getByRole('button',{name:/Choose audio or video files/}).click();
 await page.getByRole('button',{name:'Transcribe',exact:true}).click();
 await expect(page.getByText('“kuwento” is in your library')).toBeVisible();
 expect(uploads).toHaveLength(1);
 expect(uploads[0].path).toMatch(/^55555555-5555-5555-5555-555555555555\/\d+\.m4a$/);
 expect(uploads[0].type).toBe('audio/mp4');
 const recording=[...account.records.values()].find(r=>(r.data as any)?.title==='kuwento')!.data as any;
 expect(recording.media_url).toBe(`learner-media:${uploads[0].path}`);
 expect(recording.kind).toBe('audio');expect(recording.media_path).toBeNull();expect(recording.timings).toContain('[0,9,0,0.6]');

 // a YouTube video: it plays from YouTube on the web, so nothing is uploaded
 await page.getByRole('tab',{name:/Link/}).click();
 await page.getByLabel('Address').fill('https://www.youtube.com/watch?v=abcdefghijk');
 await page.getByRole('button',{name:'Open the link'}).click();
 await page.getByRole('button',{name:'Import the video'}).click();
 await expect(page.getByText('“Adobong manok” is in your library')).toBeVisible();
 expect(uploads).toHaveLength(1);
 const video=[...account.records.values()].find(r=>(r.data as any)?.title==='Adobong manok')!.data as any;
 expect(video.media_url).toBe('https://www.youtube.com/watch?v=abcdefghijk');expect(video.kind).toBe('video');expect(video.video_path).toBeNull();

 // both left this computer, files and all
 expect(await page.evaluate(()=>(window as any).__desk.lessons.length)).toBe(0);
 // the companion never mirrors the account's learning
 expect(await page.evaluate(()=>(window as any).__desk.calls.filter((c:string)=>/^sync_/.test(c)))).toEqual([]);
 expect(errors).toEqual([]);
});

test('a recording kept privately in the account plays on the website for its owner, and leaves with its lesson',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const account=fakeAccount();await account.attach(page);
 const path='55555555-5555-5555-5555-555555555555/1760000000123000.wav';
 // the account already holds a lesson the companion sent, with its private recording
 account.records.set('lesson:1760000000123000',{key:'lesson:1760000000123000',updated_at:new Date().toISOString(),server_at:new Date().toISOString(),data:{
  id:1760000000123000,lang:'tl',title:'Kuwento ni Lola',collection:'',kind:'audio',source:'C:/Users/me/kuwento.mp3',text:'Magandang araw po.',media_path:null,timings:'[[0,9,0,0.4],[10,14,0.4,0.7],[15,17,0.7,0.9]]',
  video_path:null,hue:2,word_count:3,page:0,completed:false,position:0,anchor:0,duration:1,cover_path:null,timing_v:2,created_at:1760000000,media_url:`learner-media:${path}`}});
 for(const [k,v] of [['user_name','Jamie'],['onboarded','1']])account.records.set(`setting:${k}`,{key:`setting:${k}`,data:v,updated_at:new Date().toISOString(),server_at:new Date().toISOString()});
 // one second of silence, served from a signed address the account hands only to its owner
 const rate=8000,n=rate;const wav=Buffer.alloc(44+n);wav.write('RIFF',0);wav.writeUInt32LE(36+n,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
 wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate,28);wav.writeUInt16LE(1,32);wav.writeUInt16LE(8,34);wav.write('data',36);wav.writeUInt32LE(n,40);wav.fill(128,44);
 const signed:string[]=[];const removed:string[][]=[];
 await page.route('https://wikang-test.supabase.co/storage/v1/object/sign/learner-media/**',async route=>{
  if(route.request().method()==='GET')return route.fulfill({body:wav,headers:{'Content-Type':'audio/wav','Access-Control-Allow-Origin':'*'}});
  signed.push(decodeURIComponent(new URL(route.request().url()).pathname.replace('/storage/v1/object/sign/learner-media/','')));
  await route.fulfill({json:{signedURL:`/object/sign/learner-media/${path}?token=owner-only`},headers:{'Access-Control-Allow-Origin':'*'}});
 });
 await page.route('https://wikang-test.supabase.co/storage/v1/object/learner-media',async route=>{
  if(route.request().method()==='DELETE')removed.push(route.request().postDataJSON().prefixes);
  await route.fulfill({json:[],headers:{'Access-Control-Allow-Origin':'*'}});
 });
 await page.goto('/');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByLabel('Email').fill('learner@example.org');await page.getByLabel('Password').fill('correct horse');
 await Promise.all([page.waitForEvent('load'),page.locator('.auth-submit').click()]);
 const lessonId=()=>page.evaluate(async()=>(await (window as any).__lumen?.api().lessonsList('tl'))?.find((l:any)=>l.title==='Kuwento ni Lola')?.id ?? null);
 await expect.poll(lessonId,{timeout:15000}).not.toBeNull();const id=await lessonId();
 await page.evaluate((id)=>(window as any).__lumen.useApp.getState().openLesson(id),id);
 // the player plays the private copy: its duration comes from the recording itself
 await expect.poll(()=>page.evaluate(()=>{const a=document.querySelector('audio');return a&&a.src.includes('token=owner-only')&&a.readyState>=1?Math.round(a.duration):0;}),{timeout:10000}).toBe(1);
 // only this recording is asked for (twice in development, where React runs effects twice)
 expect([...new Set(signed)]).toEqual([path]);
 await expect(page.locator('.player .time.player-total')).toHaveText('0:01');
 // deleting the lesson deletes the recording
 await page.evaluate(async(id)=>(window as any).__lumen.api().lessonDelete(id),id);
 await expect.poll(()=>removed).toEqual([[path]]);
 expect(errors).toEqual([]);
});
