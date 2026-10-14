import {test,expect} from '@playwright/test';
import {completeWelcome} from './welcome';
const userId='55555555-5555-5555-5555-555555555555';
const b64=(o:object)=>Buffer.from(JSON.stringify(o)).toString('base64url');
const exp=Math.floor(Date.now()/1000)+3600;
const token=`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:userId,exp,aud:'authenticated',role:'authenticated',email:'learner@example.org'})}.sig`;
const user={id:userId,aud:'authenticated',role:'authenticated',email:'learner@example.org',app_metadata:{},user_metadata:{},created_at:'2026-10-14T00:00:00Z'};
test('signing in after learning as a guest keeps that learning and skips the welcome',async({page})=>{
 let saved:any=null;
 const cors={'Access-Control-Allow-Origin':'*'};
 await page.route('https://wikang-test.supabase.co/**',async route=>{const url=new URL(route.request().url());
  if(url.pathname==='/auth/v1/token')return route.fulfill({json:{access_token:token,token_type:'bearer',expires_in:3600,expires_at:exp,refresh_token:'refresh',user},headers:cors});
  if(url.pathname==='/auth/v1/user')return route.fulfill({json:user,headers:cors});
  if(url.pathname.includes('/rpc/save_learner_state')){saved=route.request().postDataJSON();return route.fulfill({json:1,headers:cors});}
  // a brand-new account: no admin role, no saved learning, no published lessons
  if(url.pathname.includes('/admins')||url.pathname.includes('/learner_state'))return route.fulfill({status:200,body:'null',headers:{...cors,'Content-Type':'application/vnd.pgrst.object+json'}});
  return route.fulfill({json:[],headers:cors});
 });
 await page.goto('/');await completeWelcome(page);await expect(page.locator('.reader')).toBeVisible();
 await page.evaluate(async()=>{await (window as any).__lumen.api().termSet({lang:'tl',term:'bahay',status:4,translation:'house'})});
 await page.evaluate(()=>{(window as any).__lumen.useApp.getState().go('account');});
 await page.getByLabel('Email').fill('learner@example.org');await page.getByLabel('Password').fill('correct horse');
 // signing in reloads the app into the account
 await Promise.all([page.waitForEvent('load'),page.locator('.auth-submit').click()]);
 // the guest never gave a name: the account asks for it once, and only that
 await expect(page.getByRole('heading',{name:"Let's get acquainted"})).toBeVisible({timeout:15000});
 await expect(page.getByRole('button',{name:'Get started',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Back',exact:true})).toHaveCount(0);
 await page.getByRole('textbox',{name:'Your first name or a nickname'}).fill('Jamie');
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('button',{name:'Jamie',exact:true})).toBeVisible();
 const after=await page.evaluate(async()=>{const a=(window as any).__lumen.api();return {lessons:await a.lessonsList('tl'),terms:await a.termsList({lang:'tl',filter:'known',offset:0,limit:20})};});
 expect(after.lessons.length).toBe(1);expect(after.terms.items.map((t:any)=>t.term)).toContain('bahay');
 await expect.poll(()=>saved?.new_data?.terms?.['tl|bahay']?.status,{timeout:10000}).toBe(4);
});
