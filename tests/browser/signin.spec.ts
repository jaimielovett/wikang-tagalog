import {test,expect,type Page} from '@playwright/test';
import {completeWelcome} from './welcome';
import {fakeAccount} from './cloud';

async function signIn(page:Page) {
 await page.getByLabel('Email').fill('learner@example.org');await page.getByLabel('Password').fill('correct horse');
 // signing in reloads the app into the account
 await Promise.all([page.waitForEvent('load'),page.locator('.auth-submit').click()]);
}
const known=(page:Page)=>page.evaluate(async()=>(await (window as any).__lumen.api().termsList({lang:'tl',filter:'known',offset:0,limit:50})).items.map((t:any)=>t.term));
/** The app syncs when it comes back into view: a quick way to ask for a round now. */
const syncNow=(page:Page)=>page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));

test('signing in after learning as a guest keeps that learning and skips the welcome',async({page})=>{
 const account=fakeAccount();await account.attach(page);
 await page.goto('/');await completeWelcome(page);await expect(page.locator('.reader')).toBeVisible();
 await page.evaluate(async()=>{await (window as any).__lumen.api().termSet({lang:'tl',term:'bahay',status:4,translation:'house'})});
 await page.evaluate(()=>{(window as any).__lumen.useApp.getState().go('account');});
 await signIn(page);
 // the guest never gave a name: the account asks for it once, and only that
 await expect(page.getByRole('heading',{name:"Let's get acquainted"})).toBeVisible({timeout:15000});
 await expect(page.getByRole('button',{name:'Get started',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Back',exact:true})).toHaveCount(0);
 await page.getByRole('textbox',{name:'Your first name or a nickname'}).fill('Jamie');
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('button',{name:'Jamie',exact:true})).toBeVisible();
 const lessons=await page.evaluate(async()=>(await (window as any).__lumen.api().lessonsList('tl')).length);
 expect(lessons).toBe(1);expect(await known(page)).toContain('bahay');
 // the account now holds each piece of learning as its own record
 await expect.poll(()=>(account.records.get('term:tl|bahay')?.data as any)?.status,{timeout:10000}).toBe(4);
 await expect.poll(()=>account.records.get('setting:user_name')?.data,{timeout:10000}).toBe('Jamie');
 expect([...account.records.keys()].some(k=>/key|token|secret|password/i.test(k))).toBe(false);
});

test('two devices on one account stay in step, item by item',async({browser})=>{
 const account=fakeAccount();
 const laptop=await (await browser.newContext()).newPage();await account.attach(laptop);
 await laptop.goto('/');await completeWelcome(laptop);
 await laptop.evaluate(()=>{(window as any).__lumen.useApp.getState().go('account');});
 await signIn(laptop);
 await laptop.getByRole('button',{name:'Later',exact:true}).click();
 await laptop.evaluate(async()=>{await (window as any).__lumen.api().termSet({lang:'tl',term:'bahay',status:4,translation:'house'})});
 await expect.poll(()=>account.records.has('term:tl|bahay'),{timeout:10000}).toBe(true);

 // a second browser signs in from the welcome and goes straight to its learning
 const phone=await (await browser.newContext()).newPage();await account.attach(phone);
 await phone.goto('/');
 await phone.getByRole('button',{name:'Sign in',exact:true}).click();
 await signIn(phone);
 await expect(phone.getByRole('button',{name:'Library',exact:true})).toBeVisible({timeout:15000});
 await expect(phone.getByRole('button',{name:'Get started',exact:true})).toHaveCount(0);
 expect(await known(phone)).toContain('bahay');

 // a word learnt on the phone reaches the laptop
 await phone.evaluate(async()=>{await (window as any).__lumen.api().termSet({lang:'tl',term:'araw',status:4,translation:'day'})});
 await expect.poll(()=>account.records.has('term:tl|araw'),{timeout:10000}).toBe(true);
 await syncNow(laptop);
 await expect.poll(()=>known(laptop),{timeout:10000}).toContain('araw');
 // the later of two changes to the same setting wins on both
 await laptop.evaluate(()=>(window as any).__lumen.useApp.getState().setSetting('daily_goal','15'));
 await expect.poll(()=>account.records.get('setting:daily_goal')?.data,{timeout:10000}).toBe('15');
 await phone.evaluate(()=>(window as any).__lumen.useApp.getState().setSetting('daily_goal','30'));
 await expect.poll(()=>account.records.get('setting:daily_goal')?.data,{timeout:10000}).toBe('30');
 await syncNow(laptop);
 await expect.poll(()=>laptop.evaluate(()=>(window as any).__lumen.useApp.getState().settings.daily_goal),{timeout:10000}).toBe('30');
});

test('an account saved the old way becomes records the first time it signs in',async({page})=>{
 const account=fakeAccount();
 account.setLegacy({settings:{lang:'tl',langs:'tl',ui_lang:'en',onboarded:'1',user_name:'Jamie',daily_goal:'20'},lessons:[{id:1,lang:'tl',title:'Lumang aralin',text:'May bahay sa tabi ng dagat.',collection:'',kind:'text',source:'',media_path:null,timings:null,video_path:null,hue:40,word_count:6,page:0,completed:false,position:0,anchor:0,duration:0,cover_path:null,timing_v:0,created_at:1}],terms:{'tl|dagat':{term:'dagat',status:4,translation:'sea',note:'',lemma:'',context:'',updated_at:1}},activity:{},nextId:2,installed:[]});
 await account.attach(page);
 await page.goto('/');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await signIn(page);
 await expect(page.getByRole('button',{name:'Jamie',exact:true})).toBeVisible({timeout:15000});
 expect(await known(page)).toContain('dagat');
 await expect.poll(()=>account.records.get('lesson:1')?.data && (account.records.get('lesson:1')!.data as any).title,{timeout:10000}).toBe('Lumang aralin');
 expect(account.records.get('setting:daily_goal')?.data).toBe('20');
});
