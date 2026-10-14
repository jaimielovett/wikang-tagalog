import {test,expect} from '@playwright/test';
import {completeWelcome} from './welcome';
const id='44444444-4444-4444-4444-444444444444';
test('public prepared video opens without transcription and private learning stays independent',async({page})=>{
 let invokedTranscription=false;
 const row={id,title:'Magandang araw',text:'Magandang araw.',collection:'Test stories',kind:'video',source_url:'https://example.org/story',shelf:'learn',lo:1,hi:2,duration:2,media_path:`${id}/video.mp4`,video_path:`${id}/video.mp4`,cover_path:null,timings:[[0,9,0,1],[10,14,1,2]],tokens:[{t:'Magandang',w:true,k:'magandang',s:0,e:9},{t:' ',w:false,k:' ',s:9,e:10},{t:'araw',w:true,k:'araw',s:10,e:14},{t:'.',w:false,k:'.',s:14,e:15}],timing_v:2,created_at:'2026-10-12T00:00:00Z',published_at:'2026-10-12T00:00:00Z',status:'published',owner_id:'admin'};
 // Real browser adapter and Supabase SDK, using a bounded test backend only in this test server.
 await page.route('https://wikang-test.supabase.co/**',async route=>{const url=new URL(route.request().url());
  if(url.pathname.includes('/published_lessons'))return route.fulfill({json:url.searchParams.get('id')?row:[row],headers:{'Access-Control-Allow-Origin':'*','Content-Type':route.request().headers()['accept']?.includes('object')?'application/vnd.pgrst.object+json':'application/json'}});
  if(url.pathname.includes('/storage/v1/object/sign/')&&route.request().method()==='POST')return route.fulfill({json:{signedURL:`/object/sign/lesson-media/${id}/video.mp4?token=test`}});
  if(url.pathname.includes('/object/sign/lesson-media/'))return route.fulfill({path:'tests/fixtures/prepared-video.mp4',contentType:'video/mp4'});
  invokedTranscription=true;return route.fulfill({json:[],status:200});
 });
 await page.goto('/');await completeWelcome(page);await expect(page.locator('.reader')).toBeVisible();
 await page.getByRole('button',{name:'Discover',exact:true}).click();await expect(page.getByRole('heading',{name:'Magandang araw',exact:true})).toBeVisible();
 await page.locator('.find-hero').getByRole('button',{name:'Watch'}).click();await expect(page.locator('.reader')).toBeVisible();await expect(page.locator('video').first()).toBeVisible();
 const result=await page.evaluate(async()=>{const {api,useApp}=(window as any).__lumen;const opened=await api().lessonOpen(useApp.getState().lessonId);await api().termsMarkKnown('tl',['araw'],0);return {opened,terms:await api().termsList({lang:'tl',filter:'known',limit:20,offset:0})};});
 expect(result.opened.lesson.title).toBe('Magandang araw');expect(result.opened.lesson.timing_v).toBe(2);expect(result.opened.tokens.length).toBe(4);expect(result.terms.items[0].term).toBe('araw');expect(row).not.toHaveProperty('page');expect(invokedTranscription).toBe(false);
 await page.screenshot({path:'outputs/public-video-reader.png',fullPage:true});
});
