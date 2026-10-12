import { cloud } from './cloud';
import type { Api } from '../api';
import type { DiscoverItem, Lesson, Token } from '../types';
export interface PublishedLesson {
  id:string; title:string; text:string; collection:string; kind:'text'|'audio'|'video';
  source_url:string; shelf:DiscoverItem['shelf']; lo:number; hi:number; duration:number;
  media_path:string|null; video_path:string|null; cover_path:string|null;
  timings:number[][]|null; tokens:Token[]; timing_v:number; created_at:string; published_at:string|null;
  status:'draft'|'review'|'published'; owner_id:string;
}
export async function listPublished():Promise<PublishedLesson[]> {
  if (!cloud) return [];
  const {data,error}=await cloud.from('published_lessons').select('*').eq('status','published').order('published_at',{ascending:false}).limit(500);
  if (error) throw new Error(error.code === "PGRST205" ? "The public catalogue is still being prepared. Please try again later." : "Could not load public lessons. Please retry.");
  return data as PublishedLesson[];
}
export async function getPublished(id:string):Promise<PublishedLesson> {
  if (!cloud) throw new Error('The public lesson catalogue is not connected yet.');
  const {data,error}=await cloud.from('published_lessons').select('*').eq('id',id).single();
  if (error) throw error;
  return data as PublishedLesson;
}
const urlCache=new Map<string,{url:string;until:number}>();
export async function mediaUrl(path:string|null):Promise<string|null> {
  if (!path) return null;
  if (/^https?:/.test(path)) return path;
  if (!cloud) throw new Error('Media storage is not connected.');
  const cached=urlCache.get(path);
  if (cached && cached.until>Date.now()) return cached.url;
  const {data,error}=await cloud.storage.from('lesson-media').createSignedUrl(path,86400);
  if (error) throw error;
  urlCache.set(path,{url:data.signedUrl,until:Date.now()+23*3600_000});
  return data.signedUrl;
}
export async function adoptPublished(base:Api,id:string) {
  const existing=(await base.settingsGet())[`catalogue_${id}`];
  if (existing && (await base.lessonsList('tl')).some(l=>l.id===Number(existing))) return Number(existing);
  const row=await getPublished(id);
  const local=await base.lessonCreate({lang:'tl',title:row.title,text:row.text,collection:row.collection,kind:row.kind,source:row.source_url,
    media_path:await mediaUrl(row.media_path),video_path:await mediaUrl(row.video_path),timings:row.timings?JSON.stringify(row.timings):null});
  await base.lessonUpdate(local,{duration:row.duration});
  await base.settingsSet(`catalogue_${id}`,String(local));
  await base.settingsSet(`published_${local}`,id);
  return local;
}
export function withCatalogue(base:Api):Api {
  const open=base.lessonOpen.bind(base);
  const overrides: Partial<Api> = {async lessonOpen(id: number) {
    const result=await open(id);
    const published=(await base.settingsGet())[`published_${id}`];
    if (published) {
      const row=await getPublished(published);
      const [audio,video,cover]=await Promise.all([mediaUrl(row.media_path),mediaUrl(row.video_path),mediaUrl(row.cover_path)]);
      result.lesson={...result.lesson,media_path:audio,video_path:video,cover_path:cover,timings:row.timings?JSON.stringify(row.timings):null,timing_v:row.timing_v,duration:row.duration};
      if (row.tokens?.length) result.tokens=row.tokens;
    }
    return result;
  }};
  return new Proxy(base, {get(target,key) {return Reflect.get(overrides,key) ?? Reflect.get(target,key);}});
}
export function toDiscover(row:PublishedLesson,lessonId:number|null=null):DiscoverItem {
  const at=Date.parse(row.published_at ?? row.created_at)/1000;
  return {id:row.id,title:row.title,source:row.id,source_name:row.collection || 'Wikang Tagalog',shelf:row.shelf,kind:row.kind,url:row.source_url,page:row.source_url,image:'',summary:row.text.slice(0,220),duration:row.duration,published:at,lo:row.lo,hi:row.hi,page_text:true,fetched_at:at,lesson_id:lessonId,artist:'',track:''};
}
export type PublishedPayload=Pick<Lesson,'title'|'text'|'collection'|'kind'|'source'|'timings'|'duration'|'timing_v'>;
