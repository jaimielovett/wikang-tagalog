// Discover: reads the admin-chosen sources into a shared cache (ported from Lumen's src-tauri/src/discover.rs).
// Only titles, summaries, images and links are kept: the full text of an article is
// fetched when a learner turns it into a lesson, never stored for everyone.
import {createHash} from 'node:crypto';
import {fetchPublic} from './article.mjs';

/** Newest items kept per source and refresh. */
export const PER_SOURCE=16;
const A1=1,A2=2,B1=3,B2=4,C1=5;

// ---------- text ----------

const NAMED={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',hellip:'…',rsquo:'’',lsquo:'‘',ldquo:'“',rdquo:'”',ndash:'–',mdash:'—',laquo:'«',raquo:'»',ntilde:'ñ',Ntilde:'Ñ',eacute:'é'};
export function decodeEntities(text) {
 return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(all,code)=>{
  if(code[0]==='#'){const n=code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):Number(code.slice(1));return n>0&&n<0x110000?String.fromCodePoint(n):'';}
  return NAMED[code] ?? all;
 });
}
const cdata=(s)=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1');
/** Readable text of an HTML fragment, cut on a word at `max` characters. */
export function plain(html,max=240) {
 let text=cdata(html);if(text.includes('&lt;'))text=decodeEntities(text);
 const flat=decodeEntities(text.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
 if([...flat].length<=max)return flat;
 const cut=[...flat].slice(0,max).join('');const word=cut.slice(0,cut.lastIndexOf(' ')>0?cut.lastIndexOf(' '):cut.length);
 return word.replace(/[^\p{L}\p{N}]+$/u,'')+'…';
}

/** Common Tagalog function words: an article whose title and summary use few of them is in another language. */
const TAGALOG=new Set('ang ng mga sa na at ay si ni kay nang hindi ito iyan iyon siya sila kami tayo ako ikaw ka mo ko niya nila para pero kung dahil may mayroon wala walang naman lang din rin pa po ba nga yung yun dito doon kanyang kanilang ating aming ngayon noong habang upang bilang mula hanggang laban'.split(' '));
export function isTagalog(text) {
 const words=text.toLowerCase().match(/[\p{L}'-]+/gu)??[];
 if(!words.length)return false;
 const hits=words.filter(w=>TAGALOG.has(w)).length;
 return hits>=3&&hits/words.length>=0.12;
}

// ---------- levels (title words announce them on learner channels) ----------

const ABSOLUTE=['superbeginner','super beginner','complete beginner','absolute beginner','total beginner','super easy'];
const BEGINNER=['beginner','baguhan'];
const INTERMEDIATE=['intermediate'];
const ADVANCED=['advanced'];
const SLOW=['slow '];
/** Level a title announces: « (A1-A2) », « for Beginners », « Intermediate ». */
export function titleLevels(title) {
 const low=title.toLowerCase();
 const cefr=[...low.matchAll(/(?<![\p{L}\p{N}])([abc])([0-2])(?![\p{L}\p{N}])/gu)].map(([,l,n])=>l==='a'?(n==='2'?A2:A1):l==='b'?(n==='2'?B2:n==='1'?B1:null):C1).filter(Boolean);
 if(cefr.length)return [Math.min(...cefr),Math.max(...cefr)];
 const has=(words)=>words.some(w=>low.includes(w));
 const said=[];
 if(has(ABSOLUTE))said.push([A1,A1]);else if(has(BEGINNER))said.push([A1,A2]);
 if(has(INTERMEDIATE))said.push([B1,B2]);
 if(has(ADVANCED))said.push([B2,C1]);
 if(!said.length&&has(SLOW))said.push([A2,B1]);
 return said.length?said.reduce(([a,b],[x,y])=>[Math.min(a,x),Math.max(b,y)]):null;
}
/** The source's range, narrowed by the title; a title that clearly departs from it wins. */
export function grade(source,title) {
 const said=source.grade_titles?titleLevels(title):null;
 if(!said)return [source.lo,source.hi];
 const lo=Math.max(said[0],source.lo),hi=Math.min(said[1],source.hi);
 return lo<=hi?[lo,hi]:said;
}

// ---------- feeds ----------

const attrs=(tag)=>Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)].map(m=>[m[1].toLowerCase(),decodeEntities(m[3]??m[4]??'')]));
function inner(block,name) {
 const m=new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`,'i').exec(block);
 return m?m[1]:null;
}
const text=(block,name)=>{const v=inner(block,name);return v==null?null:decodeEntities(cdata(v).replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim()||null;};
function tags(block,names) {return [...block.matchAll(new RegExp(`<(${names})\\b([^>]*)>`,'gi'))].map(m=>({name:m[1].toLowerCase(),attrs:attrs(m[2])}));}
/** HTTPS only: plain HTTP is upgraded, anything else is dropped. */
export function secure(value,base) {
 try{const url=new URL(value.trim(),base);if(url.protocol==='http:')url.protocol='https:';return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
function parseDate(value) {const t=Date.parse(value??'');return Number.isFinite(t)?Math.floor(t/1000):0;}
function parseDuration(value) {
 if(!value)return 0;
 const parts=value.trim().split(':').map(Number);
 if(parts.some(n=>!Number.isFinite(n)))return 0;
 return parts.reduce((total,n)=>total*60+n,0);
}
const MEDIA_EXT=/\.(mp3|m4a|aac|ogg|opus|wav|flac|mp4|m4v|mov|webm)(\?|#|$)/i;

/** Items of an RSS, Atom or YouTube feed, newest first. */
export function parseFeed(xml,feedUrl,kind) {
 const atom=!/<item\b/i.test(xml);
 const blocks=[...xml.matchAll(atom?/<entry\b[\s\S]*?<\/entry>/gi:/<item\b[\s\S]*?<\/item>/gi)].map(m=>m[0]);
 const head=xml.slice(0,xml.search(atom?/<entry\b/i:/<item\b/i));
 const showImage=secure(tags(head,'itunes:image')[0]?.attrs.href??inner(inner(head,'image')??'','url')??'',feedUrl);
 const out=[];
 for(const block of blocks.slice(0,PER_SOURCE*3)) {
  const title=text(block,'title');if(!title)continue;
  let media=null,page='',image='';
  for(const tag of tags(block,'enclosure|media:content|media:thumbnail|itunes:image|link')) {
   const url=tag.attrs.url??tag.attrs.href;const type=(tag.attrs.type??'').toLowerCase();const medium=tag.attrs.medium??'';
   if(tag.name==='enclosure'||tag.name==='media:content') {
    if(!url)continue;
    if(type.startsWith('image')||medium==='image'||(!type&&!medium&&/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url))){image||=secure(url,feedUrl);}
    else if(!media&&(type.startsWith('audio')||type.startsWith('video')||medium==='audio'||medium==='video'||MEDIA_EXT.test(url)))media={url:secure(url,feedUrl),video:type.startsWith('video')||medium==='video'||/\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(url)};
   }
   else if((tag.name==='media:thumbnail'||tag.name==='itunes:image')&&!image&&url)image=secure(url,feedUrl);
   else if(tag.name==='link'&&!page) {
    const rel=tag.attrs.rel??'alternate';
    if(tag.attrs.href&&rel==='alternate')page=secure(tag.attrs.href,feedUrl);
    else if(tag.attrs.href&&rel==='enclosure'&&!media)media={url:secure(tag.attrs.href,feedUrl),video:type.startsWith('video')};
   }
  }
  if(!page){const link=text(block,'link');if(link)page=secure(link,feedUrl);}
  const html=['content:encoded','description','summary','content','media:description','itunes:summary'].map(n=>inner(block,n)).find(v=>v!=null)??'';
  if(!image){const img=/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)/i.exec(decodeEntities(cdata(html)));if(img)image=secure(img[1],feedUrl);}
  const published=parseDate(text(block,'pubDate')??text(block,'published')??text(block,'updated')??text(block,'dc:date'));
  const base={title:title.slice(0,300),image,summary:plain(html,240),published,duration:parseDuration(text(block,'itunes:duration'))};
  if(kind==='youtube') {
   const id=text(block,'yt:videoId');if(!id||!/^[\w-]{11}$/.test(id))continue;
   const url=`https://www.youtube.com/watch?v=${id}`;
   out.push({...base,key:id,url,page:url,image:image||`https://i.ytimg.com/vi/${id}/hqdefault.jpg`,kind:'video'});
  }
  else if(kind==='podcast') {
   if(!media?.url)continue;
   out.push({...base,key:text(block,'guid')??media.url,url:media.url,page,image:image||showImage,kind:media.video?'video':'audio'});
  }
  else {
   if(!page)continue;
   out.push({...base,key:text(block,'guid')??text(block,'id')??page,url:page,page,kind:'text'});
  }
 }
 // newest first; feed order breaks ties between unknown dates
 return out.map((item,i)=>({item,i})).sort((a,b)=>b.item.published-a.item.published||a.i-b.i).map(({item})=>item).slice(0,PER_SOURCE);
}

export const feedUrl=(source)=>source.kind==='youtube'?`https://www.youtube.com/feeds/videos.xml?channel_id=${source.url}`:source.url;
const itemId=(sourceId,key)=>createHash('sha256').update(`${sourceId}\n${key}`).digest('hex').slice(0,32);

/** One source's items, ready for the cache. Articles not in Tagalog are left out. */
export async function readSource(source,fetcher=fetchPublic) {
 const result=await fetcher(feedUrl(source),{accept:'application/rss+xml, application/atom+xml, application/xml, text/xml',maxBytes:3000000,tooLarge:'This feed is too large.',agent:'discover'});
 if(result.status!==200)throw new Error(`The feed answered ${result.status}.`);
 if(!/<(rss|feed|rdf:RDF)\b/i.test(result.body))throw new Error('This address is not a feed.');
 return parseFeed(result.body,result.url,source.kind)
  .filter(item=>source.kind!=='articles'||isTagalog(`${item.title} ${item.summary}`))
  .map(item=>{const [lo,hi]=grade(source,item.title);return {id:itemId(source.id,item.key),kind:item.kind,title:item.title,url:item.url,page:item.page,image:item.image,summary:item.summary,duration:item.duration,published:item.published,lo,hi};});
}

/** Ask the database for the sources to read (null: refreshed recently, or another refresh is running). */
export async function refreshDiscover({rpc,force=false,fetcher=fetchPublic}) {
 const sources=await rpc('discover_begin_refresh',{force});
 if(!sources)return {refreshed:false,sources:0,failed:[]};
 const results=[];const queue=[...sources];
 // a few at a time, each with its own timeout: one dead feed never holds up the rest
 await Promise.all(Array.from({length:Math.min(6,queue.length)},async()=>{
  for(let source=queue.shift();source;source=queue.shift()) {
   try{results.push({source_id:source.id,items:await readSource(source,fetcher)});}
   catch(error){results.push({source_id:source.id,items:[],error:String(error?.message??error).slice(0,300)});}
  }
 }));
 await rpc('discover_finish',{results});
 return {refreshed:true,sources:sources.length,failed:results.filter(r=>r.error).map(r=>r.source_id)};
}
