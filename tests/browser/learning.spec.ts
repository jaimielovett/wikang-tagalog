import {test,expect} from '@playwright/test';
test('Tagalog onboarding, dictionary, vocabulary, playlists, imports and persistence',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByRole('heading',{name:/A little more Tagalog/})).toBeVisible();
 await page.getByPlaceholder('What should we call you?').fill('Jamie');await page.getByRole('button',{name:'Start learning',exact:true}).click();
 await expect(page.locator('.reader')).toBeVisible();
 const state=await page.evaluate(async()=>{const {api,useApp}=(window as any).__lumen;const opened=await api().lessonOpen(useApp.getState().lessonId);return {lang:useApp.getState().lang(),langs:useApp.getState().langs(),text:opened.lesson.text};});
 expect(state.lang).toBe('tl');expect(state.langs).toEqual(['tl']);expect(state.text.length).toBeGreaterThan(100);
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
 await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.getByRole('heading',{name:/A little more Tagalog/})).toBeVisible();
 await page.screenshot({path:'outputs/web-mobile-welcome.png',fullPage:true});await page.getByRole('button',{name:'Start learning',exact:true}).click();await expect(page.locator('.reader')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();await page.screenshot({path:'outputs/web-mobile-reader.png',fullPage:true});
 await page.evaluate(()=>{(window as any).__lumen.useApp.getState().go('discover');});await expect(page.getByRole('heading',{name:'Discover Tagalog'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();await page.screenshot({path:'outputs/web-mobile.png',fullPage:true});
});
