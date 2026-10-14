import type { Api } from '../api';
import type { ChatMessage, ChatSummary, Lesson, Term, LangCode } from '../types';
import pkg from '../../../package.json';
import { createLocalApi } from './local';
import { initAccount, cloudRequest, cloud, useAccount } from './cloud';
import { openDb, persistence } from './storage';
import { dictionary, lookup } from './dictionary';
import { listPublished, mediaUrl, toDiscover, withCatalogue } from './catalogue';
import { PUBLISHED_SOURCE, isStale, listItems, requestRefresh } from './discover';
import { isStaleMine, mineItems, mySources, readCache, readMine } from './mysources';
import { tokenize } from '../tokenize';
import { roughEstimate } from '../level';
export async function createBrowserApi():Promise<Api> {
  await initAccount();
  const {snapshot,key}=await openDb();const db=snapshot.data;
  const {commit}=persistence(key,snapshot);const local=createLocalApi(db,commit);
  const stops=new Map<number,AbortController>();
  const discoverListeners=new Set<(lang:string)=>void>();let refreshAsked=0;let mineAsked=0;
  const unavailable=async () => {throw new Error('Use the desktop app to import, transcribe, and prepare media.');};
  const online=async (task:string,input:Record<string,unknown>,signal?:AbortSignal) => cloudRequest<{text:string}>('ai',{task,input,ui:db.settings.ui_lang || 'en'},signal);
  const chatSummary=(c:NonNullable<typeof db.chats>[number]):ChatSummary => {
    const {messages,...rest}=c;return {...rest,lesson_title:db.lessons.find(l=>l.id===c.lesson_id)?.title ?? null,count:messages.length,preview:messages.at(-1)?.content.slice(0,160) ?? ''};
  };
  const audio=async (text:string,encoding="MP3") => {
    const {audioContent}=await cloudRequest<{audioContent:string}>('voice',{text,encoding});
    return `data:${encoding === "LINEAR16" ? "audio/wav" : "audio/mp3"};base64,${audioContent}`;
  };
  const supported: Partial<Api> = {
    ...local,
    async appInfo() {return {version:pkg.version,data_dir:'This browser',platform:'web',ytdlp:false,transcriber:false,dict_langs:['tl']};},
    async appRelaunch() {location.reload();},
    async modelsList() {return [];},
    async aiWarmup() {return false;},
    async dictStatus() {return {exists:true,ready:true,downloading:false,bundled:true};},
    async dictListen() {return () => {};},
    async dictLookup(_lang,word) {return lookup(word);},
    async aiWord(_lang,word,sentence,onPiece) {const r=await online('word',{word,sentence});onPiece(r.text);return {translation:r.text,note:'',cached:false};},
    async aiSentence(_lang,sentence,onPiece) {const r=await online('sentence',{sentence});onPiece(r.text);return r.text;},
    async aiSimplify(_lang,text,level,onPiece) {const r=await online('simplify',{text,level});onPiece(r.text);return r.text;},
    async chatSend(id,text,options,onEvent) {
      const c=db.chats?.find(c=>c.id===id);if(!c) throw new Error('Conversation not found.');
      if(stops.has(id)) throw new Error('Wait for the current reply.');
      const controller=new AbortController();stops.set(id,controller);
      const user:ChatMessage={id:Date.now(),role:'user',content:text,thought:'',thought_secs:0,created_at:Date.now()/1000};
      const lesson=db.lessons.find(l=>l.id===c.lesson_id);
      try {
        const r=await online('chat',{messages:[...c.messages.slice(-16).map(m=>({role:m.role,content:m.content})),{role:'user',content:text}],lesson:lesson?.text.slice(Math.max(0,(options.focus ?? 0)-4000),Math.max(0,(options.focus ?? 0)-4000)+12000)},controller.signal);
        const assistant:ChatMessage={...user,id:user.id+1,role:'assistant',content:r.text};
        c.messages.push(user,assistant);c.updated_at=Date.now()/1000;if(!c.title)c.title=text.slice(0,80);await commit();onEvent({type:'answer',text:r.text});
        return {chat:chatSummary(c),user,assistant,stopped:false};
      } catch(e) {
        if (controller.signal.aborted) return {chat:chatSummary(c),user:null,assistant:null,stopped:true};
        throw e;
      } finally {stops.delete(id);}
    },
    async chatStop(id) {stops.get(id)?.abort();},
    async ttsSay(_lang,text) {return audio(text);},
    async lessonVoice(id,onEvent) {
      const l=db.lessons.find(l=>l.id===id);if(!l)throw new Error('Lesson not found.');
      onEvent({type:'stage',stage:'voice'});
      // Synthesise sentence chunks below Google's request size limit. Estimate timings explicitly.
      const chunks=l.text.match(/[^.!?]+[.!?]?/g)?.map(x=>x.trim()).filter(Boolean) ?? [l.text];
      if (chunks.some(c=>new TextEncoder().encode(c).length>4500)) throw new Error('A sentence is too long for natural voice. Split it into shorter sentences.');
      const parts:Uint8Array[]=[];const timing:number[][]=[];let offset=0;let elapsed=0;
      for(let i=0;i<chunks.length;i++) {
        const uri=await audio(chunks[i],"LINEAR16");const response=await fetch(uri);const bytes=new Uint8Array(await response.arrayBuffer());
        const view=new DataView(bytes.buffer);let at=12;let pcm:Uint8Array|undefined;
        while(at+8<=bytes.length){const size=view.getUint32(at+4,true);const name=String.fromCharCode(...bytes.subarray(at,at+4));if(name==='data'){pcm=bytes.slice(at+8,at+8+size);break;}at+=8+size+(size%2);}
        if(!pcm)throw new Error('Voice provider returned invalid WAV audio.');parts.push(pcm);const seconds=pcm.length/(24000*2);
        const start=l.text.indexOf(chunks[i],offset);const tokens=tokenize(chunks[i],'tl').filter(t=>t.w);
        tokens.forEach((t,n)=>timing.push([start+t.s,start+t.e,elapsed+seconds*n/tokens.length,elapsed+seconds*(n+1)/tokens.length]));
        offset=start+chunks[i].length;elapsed+=seconds;onEvent({type:'progress',value:(i+1)/chunks.length*100});
      }
      const length=parts.reduce((n,p)=>n+p.length,0);const joined=new Uint8Array(44+length);const view=new DataView(joined.buffer);
      const word=(at:number,s:string)=>{for(let i=0;i<s.length;i++)joined[at+i]=s.charCodeAt(i);};
      word(0,'RIFF');view.setUint32(4,36+length,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,24000,true);view.setUint32(28,48000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,length,true);let cursor=44;for(const p of parts){joined.set(p,cursor);cursor+=p.length;}
      const blob=new Blob([joined.buffer],{type:'audio/wav'});
      const reader=new FileReader();const uri=await new Promise<string>((resolve,reject)=>{reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob);});
      l.media_path=uri;l.timings=JSON.stringify(timing);l.duration=elapsed;l.timing_v=0;l.kind='audio';await commit();
      return {media_path:uri,timings:l.timings,timing_v:0,duration:elapsed};
    },
    async lessonVoiceCancel() {throw new Error('Voice generation will finish the current short sentence.');},
    async exportVocab(lang,_path) {
      const rows=Object.entries(db.terms).filter(([k])=>k.startsWith(lang+'|')).map(([,v])=>v);
      download('tagalog-vocabulary.csv','term,status,translation,note\n'+rows.map(r=>[r.term,r.status,r.translation,r.note].map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n'),'text/csv');
    },
    async discoverList() {
      const [rows,feed]=await Promise.all([listPublished(),listItems()]);
      const off=(id:string)=>db.settings[`source_off_${id}`]==='1';
      const lessonOf=(id:string)=>Number(db.settings[`catalogue_${id}`])||null;
      // the first visit sets the baseline for sources marked "New"
      if(!db.settings.sources_seen_at) void local.settingsSet('sources_seen_at',String(Math.floor(Date.now()/1000)));
      const shown=rows.filter(r=>!db.settings[`hidden_${r.id}`]);
      const covers=await Promise.all(shown.map(r=>mediaUrl(r.cover_path).catch(()=>null)));
      // published lessons stay searchable when their source is off ("muted"), and replace the same video from a source
      const published=shown.map((r,i)=>({...toDiscover(r,lessonOf(r.id)),source:PUBLISHED_SOURCE,image:covers[i] ?? '',muted:off(PUBLISHED_SOURCE)}));
      const prepared=new Set(rows.map(r=>r.source_url).filter(Boolean));
      const found=feed.items.filter(it=>!off(it.source)&&!db.settings[`hidden_${it.id}`]&&!prepared.has(it.url)).map(it=>({...it,lesson_id:lessonOf(it.id)}));
      // the learner's own sources: items kept on this device, read again once stale (each request uses the daily budget)
      const mine=mySources(db.settings).filter(s=>!off(s.id));
      const cache=mine.length?await readCache():{};
      const seenUrls=new Set(found.map(it=>it.url));
      const own=mine.flatMap(s=>mineItems(s,cache)).filter(it=>!db.settings[`hidden_${it.id}`]&&!prepared.has(it.url)&&!seenUrls.has(it.url)).map(it=>({...it,lesson_id:lessonOf(it.id)}));
      const stale=mine.filter(s=>isStaleMine(cache,s));
      if(useAccount.getState().session&&stale.length&&Date.now()-mineAsked>10*60_000) {
        mineAsked=Date.now();
        void readMine(stale).then(()=>discoverListeners.forEach(f=>f('tl'))).catch(()=>{});
      }
      // a stale cache refreshes itself; the view reloads when the server is done
      let refreshing=feed.refreshing;
      if(cloud&&!refreshing&&isStale(feed.refreshedAt)&&Date.now()-refreshAsked>10*60_000) {
        refreshAsked=Date.now();refreshing=true;
        void requestRefresh().then(r=>{if(r.refreshed)discoverListeners.forEach(f=>f('tl'));}).catch(()=>{});
      }
      return {items:[...published,...found,...own],refreshed_at:feed.refreshedAt,refreshing,sources:new Set(feed.items.map(it=>it.source)).size+1+mine.length};
    },
    async discoverRefresh() {
      // the shared cache (at most every few hours) and, when signed in, the learner's own sources
      const mine=useAccount.getState().session?mySources(db.settings).filter(s=>db.settings[`source_off_${s.id}`]!=='1'):[];
      const [r,own]=await Promise.all([requestRefresh(),mine.length?readMine(mine).then(()=>true,()=>false):false]);
      return {added:0,sources:r.sources+mine.length,failed:r.failed,skipped:!r.refreshed&&!own};
    },
    async discoverMark(id,lesson) {await local.settingsSet(`catalogue_${id}`,String(lesson));},
    async discoverHide(id) {await local.settingsSet(`hidden_${id}`,'1');},
    async discoverListen(onChange) {discoverListeners.add(onChange);return () => {discoverListeners.delete(onChange);};},
    async levelEstimate(lang) {const forms=Object.entries(db.terms).filter(([k,t])=>k.startsWith(lang+'|')&&t.status===4&&!t.term.includes(' ')).length;return roughEstimate(lang,forms);},
    async textStats(lang,text) {const words=tokenize(text,lang).filter(t=>t.w);const unique=new Set(words.map(t=>t.k));const fresh=[...unique].filter(k=>!db.terms[`${lang}|${k}`]).length;return {words:words.length,unique:unique.size,new_words:fresh,new_pct:unique.size?Math.round(100*fresh/unique.size):0,known_pct:unique.size?Math.round(100*(unique.size-fresh)/unique.size):100};},
    async mediaCodecs() {},
    mediaUrl(path) {return path;},
    async readFile(path) {const r=await fetch(path);if(!r.ok)throw new Error('File not found.');return r.arrayBuffer();},
    async mediaStream(url) {const lesson=db.lessons.find(l=>l.source===url);if(!lesson?.media_path)throw new Error('Open a prepared lesson from Discover.');return {video:lesson.video_path ?? '',audio:lesson.media_path,width:0,height:0,language:'tl',title:lesson.title,description:lesson.text,author:'',duration:lesson.duration,published:0,count:0};},
    async searchOnline(_lang,_platform,query) {const rows=await listPublished();return {hits:rows.filter(r=>(r.title+' '+r.collection).toLowerCase().includes(query.toLowerCase())).map(r=>({id:r.id,platform:'youtube' as const,kind:r.kind,title:r.title,url:r.source_url,page:r.source_url,image:'',author:r.collection,summary:r.text.slice(0,160),duration:r.duration,published:Date.parse(r.published_at??r.created_at)/1000,count:0,lo:r.lo,hi:r.hi,in_lang:true,other_lang:'',album:'',sample:'',lyrics:null,words:tokenize(r.text,'tl').filter(t=>t.w).length})),more:false};},
    async backupListen() {return () => {};},async backupPlaces() {return [];},
    async podcastCreate(_lang,request,onEvent) {onEvent({type:'stage',stage:'script'});const result=await online('podcast',{request});const id=await local.lessonCreate({lang:'tl',title:'Tagalog podcast',text:result.text,collection:'My podcasts'});await supported.lessonVoice!(id,onEvent);return id;},
    async linkProbe(url) {const page=await cloudRequest<{url:string;html:string}>('article',{url});return {url:page.url,title:'',site:'',image:'',html:page.html,media:[],list:false,via:'',note:''};},
    importMedia:unavailable,importLink:unavailable,lessonFetchVideo:unavailable,lessonResync:unavailable,
  };
  const base=new Proxy(supported,{get(target,key) {if(key === "then") return undefined; return Reflect.get(target,key) ?? unavailable;}}) as Api;
  void dictionary().catch(()=>{});
  return withCatalogue(base);
}
export function download(name:string,content:string,type='application/json') {
  const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export type { Lesson, Term, LangCode };
