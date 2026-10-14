import type {Page} from '@playwright/test';
// A stand-in for the account's Supabase project in browser tests: sign-in, and learning
// records kept with the database's rule (per record, the newest change wins).
const b64=(o:object)=>Buffer.from(JSON.stringify(o)).toString('base64url');
export function fakeAccount(email='learner@example.org',id='55555555-5555-5555-5555-555555555555') {
 const exp=Math.floor(Date.now()/1000)+3600;
 const user={id,aud:'authenticated',role:'authenticated',email,app_metadata:{},user_metadata:{},created_at:'2026-10-14T00:00:00Z'};
 const token=`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:id,exp,aud:'authenticated',role:'authenticated',email})}.sig`;
 const records=new Map<string,{key:string;data:unknown;updated_at:string;server_at:string}>();
 const pushes:{key:string;data:unknown}[]=[];
 let tick=0;let legacy:unknown=null;
 const cors={'Access-Control-Allow-Origin':'*'};
 return {records,pushes,setLegacy(data:unknown){legacy=data;},
  async attach(page:Page) {
   await page.route('https://wikang-test.supabase.co/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/auth/v1/token')return route.fulfill({json:{access_token:token,token_type:'bearer',expires_in:3600,expires_at:exp,refresh_token:'refresh',user},headers:cors});
    if(url.pathname==='/auth/v1/user')return route.fulfill({json:user,headers:cors});
    if(url.pathname.endsWith('/rpc/push_learner_records')) {
     const rows=route.request().postDataJSON().records as {key:string;data:unknown;updated_at:string}[];
     for(const r of rows){pushes.push(r);const t=Math.min(Date.parse(r.updated_at),Date.now());const old=records.get(r.key);
      if(!old||Date.parse(old.updated_at)<t)records.set(r.key,{key:r.key,data:r.data,updated_at:new Date(t).toISOString(),server_at:new Date(Date.now()+(++tick)).toISOString()});}
     return route.fulfill({json:rows.length,headers:cors});
    }
    if(url.pathname.endsWith('/learner_records')) {
     const since=url.searchParams.get('server_at')?.replace(/^gt\./,'');
     return route.fulfill({json:[...records.values()].filter(r=>!since||r.server_at>since).sort((a,b)=>a.server_at.localeCompare(b.server_at)),headers:cors});
    }
    if(url.pathname.endsWith('/learner_state'))return route.fulfill({status:200,body:legacy?JSON.stringify({data:legacy}):'null',headers:{...cors,'Content-Type':'application/vnd.pgrst.object+json'}});
    if(url.pathname.includes('/admins'))return route.fulfill({status:200,body:'null',headers:{...cors,'Content-Type':'application/vnd.pgrst.object+json'}});
    if(url.pathname.endsWith('/rpc/discover_status'))return route.fulfill({json:{last_refresh_at:new Date().toISOString(),refreshing:false},headers:cors});
    return route.fulfill({json:[],headers:cors});
   });
  },
 };
}
