import {test,expect} from '@playwright/test';
import {completeWelcome} from './welcome';
test('Tagalog onboarding, dictionary, vocabulary, playlists, imports and persistence',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByRole('heading',{name:'Wikang Tagalog',exact:true})).toBeVisible();
 await completeWelcome(page,'Jamie',20);
 await expect(page.locator('.reader')).toBeVisible();
 const state=await page.evaluate(async()=>{const {api,useApp}=(window as any).__lumen;const opened=await api().lessonOpen(useApp.getState().lessonId);return {goal:useApp.getState().settings.daily_goal,lang:useApp.getState().lang(),langs:useApp.getState().langs(),text:opened.lesson.text};});
 expect(state.goal).toBe('20');expect(state.lang).toBe('tl');expect(state.langs).toEqual(['tl']);expect(state.text.length).toBeGreaterThan(100);
 const result=await page.evaluate(async()=>{const a=(window as any).__lumen.api();const definition=await a.dictLookup('tl','bahay');await a.termSet({lang:'tl',term:'bahay',status:4,translation:'house'});const id=await a.playlistCreate('tl','My practice',[]);return {definition,terms:await a.termsList({lang:'tl',filter:'known',offset:0,limit:20}),playlist:await a.playlistsList('tl'),id};});
 expect(result.definition.entries.length).toBeGreaterThan(0);expect(result.terms.items[0].term).toBe('bahay');expect(result.playlist[0].name).toBe('My practice');
 await page.evaluate(()=>{(window as any).__lumen.useApp.getState().go('library');});
 await page.getByRole('button',{name:'Import a lesson',exact:true}).first().click();await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByLabel('Lesson title').fill('A new Tagalog story');await page.getByLabel('Tagalog text').fill('May isang maliit na bahay. Maganda ang araw.');await page.getByRole('button',{name:'Add to my library'}).click();
 await expect(page.locator('.reader')).toBeVisible();await expect(page.getByText('A new Tagalog story',{exact:true}).first()).toBeVisible();
 await page.reload();await expect(page.getByRole('button',{name:'Now reading',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Now reading',exact:true}).click();await expect(page.locator('.reader')).toBeVisible();
 const saved=await page.evaluate(async()=>{const a=(window as any).__lumen.api();return {lessons:await a.lessonsList('tl'),terms:await a.termsList({lang:'tl',filter:'known',offset:0,limit:20})};});
 expect(saved.lessons.some((l:any)=>l.title==='A new Tagalog story')).toBeTruthy();expect(saved.terms.items.some((t:any)=>t.term==='bahay')).toBeTruthy();
 await page.getByRole('button',{name:'Discover',exact:true}).click();await expect(page.getByRole('heading',{name:'Discover Tagalog'})).toBeVisible();await expect(page.getByText('The next story starts here')).toBeVisible();
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Backup',exact:true}).click();await expect(page.getByRole('button',{name:'Export backup'})).toBeVisible();
 await page.screenshot({path:'outputs/web-desktop.png',fullPage:true});expect(errors).toEqual([]);
});
test('mobile onboarding and navigation do not overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.getByRole('heading',{name:'Wikang Tagalog',exact:true})).toBeVisible();
 await page.screenshot({path:'outputs/web-mobile-welcome.png',fullPage:true});await completeWelcome(page);await expect(page.locator('.reader')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();await page.screenshot({path:'outputs/web-mobile-reader.png',fullPage:true});
 await page.evaluate(()=>{(window as any).__lumen.useApp.getState().go('discover');});await expect(page.getByRole('heading',{name:'Discover Tagalog'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();await page.screenshot({path:'outputs/web-mobile.png',fullPage:true});
});

test('web guidance explains online services without desktop privacy or installation claims', async ({page}) => {
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/');
 await completeWelcome(page);
 await expect(page.locator('.reader')).toBeVisible();
 const dock=page.getByRole('button',{name:'Dock the word panel on the right'});
 if (await dock.count()) await dock.click();
 await expect(page.getByText('Dictionary meanings appear here.', {exact:false})).toBeVisible();
 await page.getByRole('button', {name:/Open the short guide|How does Wikang Tagalog work/}).click();
 const guide=page.getByRole('dialog', {name:"Wikang Tagalog's short guide"});
 await expect(guide.locator('.g-line')).toHaveAttribute('lang', 'tl');
 await guide.getByRole('tab', {name:'Listen, the lantern follows'}).click();
 await expect(guide.getByText(/Video downloads and transcription happen in the desktop app/)).toBeVisible();
 await guide.getByRole('tab', {name:'Your browser, connected'}).click();
 await expect(guide.getByText(/send the relevant text to the provider/)).toBeVisible();
 await expect(guide.getByText(/private learning data syncs through Supabase/)).toBeVisible();
 await expect(guide.getByText(/^To install$|Whisper|Supertonic|Qwen3|on your Mac|never leaves/i)).toHaveCount(0);
 await expect(guide.getByText('Internet and sign-in required')).toBeVisible();
 await page.screenshot({path:'outputs/web-guide-corrected.png',fullPage:true});
 await guide.getByRole('button', {name:'Voice & AI settings'}).click();
 await expect(page.getByRole('heading',{name:'Tagalog, spoken and understood'})).toBeVisible();
 await page.getByRole('button', {name:'Profile',exact:true}).click();
 await expect(page.getByText('Private account sync',{exact:true})).toBeVisible();
 await expect(page.getByText(/has no account|Not in iCloud|On this Mac/)).toHaveCount(0);
 await page.getByRole('button', {name:'Chat',exact:true}).first().click();
 await expect(page.getByText('Your Tagalog tutor, online',{exact:true})).toBeVisible();
 await page.evaluate(async()=>{await (window as any).__lumen.useApp.getState().startTour()});
 await expect(page.getByRole('dialog',{name:'Guided tour'})).toBeVisible({timeout:10000});
 for (const step of [4,5,10,11,12]) {
  await page.evaluate((step)=>{(window as any).__lumen.useApp.getState().setTourStep(step)},step);
  const tour=page.getByRole('dialog',{name:'Guided tour'});
  await expect(tour).toBeVisible({timeout:10000});
  await expect(tour.getByText(/never leaves your Mac|Download Qwen|Local AI|offline|With a Gemini key/)).toHaveCount(0);
 }
 await page.evaluate(()=>{(window as any).__lumen.useApp.getState().endTour()});
});

test('welcome offers Supabase recovery and can be replayed without losing learning', async ({page}) => {
 await page.goto('/');
 await page.getByRole('button',{name:/I've used Wikang Tagalog before/}).click();
 await expect(page.getByRole('textbox',{name:'Email',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Create an account',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back to the welcome',exact:true}).click();
 await completeWelcome(page,'Jamie');
 await page.evaluate(async()=>{await (window as any).__lumen.api().termSet({lang:'tl',term:'bahay',status:4,translation:'house'})});
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'About',exact:true}).click();
 await page.getByRole('button',{name:'Replay the welcome',exact:true}).click();
 await completeWelcome(page,'Jamie');
 const saved=await page.evaluate(async()=>{const a=(window as any).__lumen.api();return {lessons:await a.lessonsList('tl'),terms:await a.termsList({lang:'tl',filter:'known',offset:0,limit:20})};});
 expect(saved.lessons).toHaveLength(1);
 expect(saved.terms.items.some((t:any)=>t.term==='bahay')).toBeTruthy();
});
