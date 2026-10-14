import {fail} from '../server/services.mjs';
import {refreshDiscover} from '../server/discover.mjs';
// Reads the Discover sources into the shared cache. The database only accepts results
// signed with DISCOVER_SECRET, refreshes at most every few hours, and never twice at once,
// so visitors may ask freely: a stale cache refreshes itself.
export default async function handler(req,res) {
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'GET or POST required.'});
 try {
  const url=process.env.SUPABASE_URL?.trim().replace(/\/+$/,'');const key=process.env.SUPABASE_ANON_KEY?.trim();const secret=process.env.DISCOVER_SECRET?.trim();
  if(!url||!key||!secret)throw Object.assign(new Error('Discover refresh is not configured yet.'),{status:503});
  const call=async(name,body,authorization=`Bearer ${key}`)=>{
   const response=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
   if(!response.ok) {
    // say what is wrong with the setup; nothing here reveals the secret itself
    const answer=await response.json().catch(()=>({}));const reason=String(answer.message??answer.msg??answer.error??'');
    if(reason.includes('refresh_not_allowed'))throw Object.assign(new Error('Discover refresh is not set up: DISCOVER_SECRET (at least 24 characters) must match the hash stored in public.discover_refresh. See the README.'),{status:503});
    if(reason.includes('Could not find the function'))throw Object.assign(new Error('Discover refresh is not set up: run supabase/migrations/202610140001_discover_sources.sql.'),{status:503});
    // Supabase's own short answer (never a key or the secret) makes a setup problem findable
    throw Object.assign(new Error(`Discover could not be refreshed: Supabase answered ${response.status}${reason?` (${reason.slice(0,160)})`:''}.`),{status:502});
   }
   // a function that returns nothing answers with an empty body
   const text=await response.text();
   return text?JSON.parse(text):null;
  };
  const authorization=req.headers.authorization||'';
  // the scheduled job and admins skip the "refreshed recently" window (never the lock)
  const scheduled=!!process.env.CRON_SECRET&&authorization===`Bearer ${process.env.CRON_SECRET}`;
  const admin=!scheduled&&/^Bearer \S+$/.test(authorization)&&await call('is_admin',{},authorization).catch(()=>false)===true;
  const result=await refreshDiscover({force:scheduled||admin,rpc:(name,body)=>call(name,{...body,secret})});
  res.setHeader('Cache-Control','no-store');res.status(200).json(result);
 }catch(error){fail(res,error);}
}
