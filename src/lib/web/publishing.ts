import { cloud } from './cloud';
import { api,isTauri } from '../api';
import type { PublishedLesson } from './catalogue';
import { tokenize } from '../tokenize';
export async function preparePublication(lessonId:number,onProgress:(stage:string,value:number)=>void) {
 if(!isTauri)throw new Error('Prepare media in the desktop app.');if(!cloud)throw new Error('Connect Supabase before publishing.');
 const {data:{session}}=await cloud.auth.getSession();if(!session)throw new Error('Sign in as an admin.');
 const {lesson}=await api().lessonOpen(lessonId);
 const {data,error}=await cloud.from('published_lessons').insert({title:lesson.title,text:lesson.text,kind:'text',collection:lesson.collection,source_url:/^https?:\/\//.test(lesson.source)?lesson.source:"",status:'draft',owner_id:session.user.id}).select().single();if(error)throw error;
 const {invoke,Channel}=await import('@tauri-apps/api/core');const channel=new Channel<{type:string;stage?:string;value?:number}>();channel.onmessage=e=>onProgress(e.stage ?? 'uploading',e.value ?? 0);
 try {
  const payload=await invoke<Record<string,unknown>>('publish_prepare',{lessonId,draftId:data.id,supabaseUrl:import.meta.env.VITE_SUPABASE_URL,publishableKey:import.meta.env.VITE_SUPABASE_ANON_KEY,accessToken:session.access_token,onEvent:channel});
  const {error:saveError}=await cloud.from('published_lessons').update({...payload,status:'review'}).eq('id',data.id);if(saveError)throw saveError;return data.id as string;
 }catch(error){throw new Error(`Preparation failed. Draft ${data.id} is retained in your queue; delete it before retrying. ${error instanceof Error?error.message:String(error)}`);}
}
export async function queue():Promise<PublishedLesson[]> {
 if(!cloud)return [];const {data,error}=await cloud.from('published_lessons').select('*').neq('status','published').order('created_at',{ascending:false});if(error)throw error;return data as PublishedLesson[];
}
export function validatePublication(row:PublishedLesson) {
 if(!row.text.trim()||!row.title.trim())throw new Error('A title and transcript are required.');
 if(!row.tokens.length)throw new Error('Prepare the lesson before publishing.');
 if(JSON.stringify(row.tokens)!==JSON.stringify(tokenize(row.text,'tl'))) {
   // Rust includes exactly the same public token fields; check offsets/text rather than property order.
   const generated=tokenize(row.text,'tl');if(row.tokens.length!==generated.length||row.tokens.some((t,i)=>t.t!==generated[i].t||t.s!==generated[i].s||t.e!==generated[i].e))throw new Error('The transcript changed after preparation. Prepare a new draft.');
 }
 if(row.kind!=='text'&&(!row.media_path||!row.timings?.length))throw new Error('Audio/video lessons need prepared media and word timings.');
 if(row.kind==='video'&&!row.video_path)throw new Error('Prepare the video before publishing.');
 let last=0;
 for(const timing of row.timings ?? []) {
  if(timing.length!==4||timing.some(n=>!Number.isFinite(n))||timing[0]<0||timing[1]<=timing[0]||timing[1]>row.text.length||timing[2]<last||timing[3]<timing[2])throw new Error('Invalid transcript timings. Prepare a new draft.');
  last=timing[2];
 }
}
export async function publish(row:PublishedLesson,rightsConfirmed:boolean) {
 if(!rightsConfirmed)throw new Error('Confirm permission to share this lesson.');validatePublication(row);if(!cloud)throw new Error('Supabase is not connected.');
 const {error}=await cloud.from('published_lessons').update({status:'published',published_at:new Date().toISOString(),rights_confirmed:true}).eq('id',row.id).eq('status','review');if(error)throw error;
}
export async function removeDraft(id:string) {
 if(!cloud)return;const {data,error}=await cloud.storage.from('lesson-media').list(id);if(error)throw error;
 if(data.length){const {error:e}=await cloud.storage.from('lesson-media').remove(data.map(f=>`${id}/${f.name}`));if(e)throw e;}
 const {error:e}=await cloud.from('published_lessons').delete().eq('id',id);if(e)throw e;
}
