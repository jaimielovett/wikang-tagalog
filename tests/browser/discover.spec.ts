import {test,expect,type Page} from '@playwright/test';
import {completeWelcome} from './welcome';
const now=new Date().toISOString();
const sources=[
 {id:'tl-language-crush',name:'Language Crush Tagalog',kind:'youtube',url:'UCRzEyp4XtyTpGhdEuriB9iQ',shelf:'learn',lo:1,hi:3,grade_titles:true,enabled:true,created_at:'2026-10-14T00:00:00Z',retired_at:null,last_fetched_at:now,last_error:null,item_count:1},
 {id:'tl-bandera',name:'Bandera',kind:'articles',url:'https://bandera.inquirer.net/feed',shelf:'news',lo:1,hi:5,grade_titles:false,enabled:true,created_at:'2026-10-14T00:00:00Z',retired_at:null,last_fetched_at:now,last_error:'The feed answered 503.',item_count:1},
];
const items=[
 {id:'a'.repeat(32),source_id:'tl-language-crush',kind:'video',title:'Tagalog for Beginners: Greetings',url:'https://www.youtube.com/watch?v=abcdefghijk',page:'https://www.youtube.com/watch?v=abcdefghijk',image:'',summary:'Kumusta! Salamat sa panonood.',duration:0,published_at:now,lo:1,hi:2,fetched_at:now},
 {id:'b'.repeat(32),source_id:'tl-bandera',kind:'text',title:'Arnold Clavio kinasuhan ng cyber libel',url:'https://bandera.inquirer.net/1',page:'https://bandera.inquirer.net/1',image:'',summary:'Kinasuhan ng cyber libel ang broadcaster.',duration:0,published_at:now,lo:1,hi:5,fetched_at:now},
];
async function mockCloud(page:Page,{admin=false}={}) {
 const cors={'Access-Control-Allow-Origin':'*'};
 await page.route('https://www.youtube-nocookie.com/**',route=>route.fulfill({body:'<html></html>',contentType:'text/html'}));
 await page.route('https://wikang-test.supabase.co/**',async route=>{const url=new URL(route.request().url());
  if(url.pathname.endsWith('/discover_sources'))return route.fulfill({json:sources,headers:cors});
  if(url.pathname.endsWith('/discover_items'))return route.fulfill({json:items,headers:cors});
  if(url.pathname.endsWith('/rpc/discover_status'))return route.fulfill({json:{last_refresh_at:now,refreshing:false},headers:cors});
  if(url.pathname.includes('/admins'))return route.fulfill({status:200,body:admin?'{"user_id":"x"}':'null',headers:{...cors,'Content-Type':'application/vnd.pgrst.object+json'}});
  return route.fulfill({json:[],headers:cors});
 });
}
test('Discover shows the sources, plays a video in place, and a learner can switch a source off',async({page})=>{
 await mockCloud(page);
 await page.goto('/?app');await completeWelcome(page);
 await page.getByRole('button',{name:'Discover',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Tagalog for Beginners: Greetings'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Arnold Clavio kinasuhan ng cyber libel'})).toBeVisible();
 // a video plays in the sheet; making it a lesson is the desktop app's job
 await page.locator('.find-hero').getByRole('button',{name:'Watch',exact:true}).click();
 const sheet=page.getByRole('dialog');
 await expect(sheet.locator('iframe[src*="youtube-nocookie.com/embed/abcdefghijk"]')).toBeVisible();
 await expect(sheet.getByText('A lesson, in the desktop app')).toBeVisible();
 // the desktop app's installer for this computer, straight from the site
 const get=sheet.getByRole('link',{name:/^Download for (Windows|Mac)$/});await expect(get).toBeVisible();await expect(get).toHaveAttribute('href',/^\/api\/download\?platform=(windows|mac)$/);
 await page.keyboard.press('Escape');
 // a guest reading an article is invited to sign in to make it a lesson
 await page.getByRole('button',{name:'Preview Arnold Clavio kinasuhan ng cyber libel'}).click();
 await expect(page.getByRole('dialog').getByText('Sign in to make it a lesson')).toBeVisible();
 await page.keyboard.press('Escape');
 // switching Bandera off removes its article
 await page.getByRole('button',{name:'Sources',exact:true}).click();
 await expect(page.getByRole('dialog').getByText('Wikang Tagalog lessons')).toBeVisible();
 await expect(page.getByRole('dialog').getByText('Add your own sources')).toBeVisible();
 await page.getByRole('switch',{name:'Bandera'}).click();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('heading',{name:'Arnold Clavio kinasuhan ng cyber libel'})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Tagalog for Beginners: Greetings'})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__wikang.useApp.getState().settings['source_off_tl-bandera'])).toBe('1');
});

test('admins see every source with its health, and add sources from the Account page',async({page})=>{
 await mockCloud(page,{admin:true});
 const b64=(o:object)=>Buffer.from(JSON.stringify(o)).toString('base64url');const exp=Math.floor(Date.now()/1000)+3600;
 const user={id:'66666666-6666-6666-6666-666666666666',aud:'authenticated',role:'authenticated',email:'admin@example.org',app_metadata:{},user_metadata:{},created_at:now};
 const token=`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:user.id,exp,aud:'authenticated',role:'authenticated'})}.sig`;
 let inserted:any=null;
 await page.route('https://wikang-test.supabase.co/**',async route=>{const url=new URL(route.request().url());const cors={'Access-Control-Allow-Origin':'*'};
  if(url.pathname==='/auth/v1/token')return route.fulfill({json:{access_token:token,token_type:'bearer',expires_in:3600,expires_at:exp,refresh_token:'r',user},headers:cors});
  if(url.pathname==='/auth/v1/user')return route.fulfill({json:user,headers:cors});
  if(url.pathname.endsWith('/discover_sources')&&route.request().method()==='POST'){inserted=route.request().postDataJSON();return route.fulfill({status:201,body:'',headers:cors});}
  return route.fallback();
 });
 await page.goto('/?app');await completeWelcome(page);
 await page.evaluate(()=>{(window as any).__wikang.useApp.getState().go('account');});
 await page.getByLabel('Email').fill('admin@example.org');await page.getByLabel('Password').fill('correct horse');
 await Promise.all([page.waitForEvent('load'),page.locator('.auth-submit').click()]);
 await page.getByRole('button',{name:'Later',exact:true}).click();
 await page.evaluate(()=>{(window as any).__wikang.useApp.getState().go('account');});
 await expect(page.getByRole('heading',{name:'Discover sources'})).toBeVisible();
 await expect(page.getByText('The feed answered 503.')).toBeVisible();
 await page.getByRole('button',{name:'Add a source'}).click();
 await page.getByLabel('Name').fill('Bombo Radyo');
 await page.getByLabel('Address').fill('youtube.com/@bombo');
 await page.getByRole('button',{name:'Save source'}).click();
 await expect(page.getByText(/Paste the channel ID/)).toBeVisible();
 await page.getByLabel('Address').fill('https://www.youtube.com/channel/UCRzEyp4XtyTpGhdEuriB9iQ');
 await page.getByRole('button',{name:'Save source'}).click();
 await expect.poll(()=>inserted?.id).toBe('tl-bombo-radyo');
 expect(inserted.url).toBe('UCRzEyp4XtyTpGhdEuriB9iQ');expect(inserted.kind).toBe('youtube');
});

test('signed-in learners add their own sources; a default source is recognised, and removing one clears its items',async({page})=>{
 await mockCloud(page);
 const b64=(o:object)=>Buffer.from(JSON.stringify(o)).toString('base64url');const exp=Math.floor(Date.now()/1000)+3600;
 const user={id:'77777777-7777-7777-7777-777777777777',aud:'authenticated',role:'authenticated',email:'learner@example.org',app_metadata:{},user_metadata:{},created_at:now};
 const token=`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:user.id,exp,aud:'authenticated',role:'authenticated'})}.sig`;
 await page.route('https://wikang-test.supabase.co/**',async route=>{const url=new URL(route.request().url());const cors={'Access-Control-Allow-Origin':'*'};
  if(url.pathname==='/auth/v1/token')return route.fulfill({json:{access_token:token,token_type:'bearer',expires_in:3600,expires_at:exp,refresh_token:'r',user},headers:cors});
  if(url.pathname==='/auth/v1/user')return route.fulfill({json:user,headers:cors});
  return route.fallback();
 });
 const reads:any[]=[];
 await page.route('**/api/discover-source',async route=>{const body=route.request().postDataJSON();
  if(body.action==='find')return route.fulfill({json:/bandera/.test(body.url)?{kind:'articles',url:'https://bandera.inquirer.net/feed',name:'Bandera'}:{kind:'youtube',url:'UCvQrjgLj841wiQAKDgtKFOw',name:'Ninong Ry'}});
  reads.push(body);
  return route.fulfill({json:{results:body.sources.map((s:any)=>({id:s.id,items:[{id:'c'.repeat(32),kind:'video',title:'Adobong manok ni Ninong',url:'https://www.youtube.com/watch?v=ninongry001',page:'https://www.youtube.com/watch?v=ninongry001',image:'',summary:'',duration:0,published:Math.floor(Date.now()/1000),lo:1,hi:3}]}))}});
 });
 await page.goto('/?app');await completeWelcome(page);
 await page.evaluate(()=>{(window as any).__wikang.useApp.getState().go('account');});
 await page.getByLabel('Email').fill('learner@example.org');await page.getByLabel('Password').fill('correct horse');
 await Promise.all([page.waitForEvent('load'),page.locator('.auth-submit').click()]);
 await page.getByRole('button',{name:'Later',exact:true}).click();
 await page.getByRole('button',{name:'Discover',exact:true}).click();
 await page.getByRole('button',{name:/^Sources/}).click();
 const sheet=page.getByRole('dialog');
 await sheet.getByLabel('Source address').fill('bandera.inquirer.net');await sheet.getByRole('button',{name:'Add',exact:true}).click();
 await expect(sheet.getByText("“Bandera” is already one of Discover's sources.")).toBeVisible();
 await sheet.getByLabel('Source address').fill('https://www.youtube.com/@ninongry');await sheet.getByRole('button',{name:'Add',exact:true}).click();
 await expect(sheet.getByText('YouTube channel · 1 item')).toBeVisible();
 expect(reads[0].sources[0]).toMatchObject({kind:'youtube',url:'UCvQrjgLj841wiQAKDgtKFOw',lo:2,hi:4,grade_titles:true});expect(reads[0].sources[0].id).toMatch(/^mine-/);
 await page.keyboard.press('Escape');
 await expect(page.getByRole('heading',{name:'Adobong manok ni Ninong'})).toBeVisible();
 await page.getByRole('button',{name:/^Sources/}).click();
 await sheet.getByRole('button',{name:'Remove Ninong Ry'}).click();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('heading',{name:'Adobong manok ni Ninong'})).toHaveCount(0);
});
