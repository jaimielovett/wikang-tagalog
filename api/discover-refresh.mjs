import {fail} from '../server/services.mjs';
import {refreshDiscover} from '../server/discover.mjs';
// Reads the Discover sources into the shared cache. The database only accepts results
// signed with DISCOVER_SECRET, refreshes at most every few hours, and never twice at once,
// so visitors may ask freely: a stale cache refreshes itself.
export default async function handler(req,res) {
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'GET or POST required.'});
 try {
  const url=process.env.SUPABASE_URL;const key=process.env.SUPABASE_ANON_KEY;const secret=process.env.DISCOVER_SECRET;
  if(!url||!key||!secret)throw Object.assign(new Error('Discover refresh is not configured yet.'),{status:503});
  const call=async(name,body,authorization=`Bearer ${key}`)=>{
   const response=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Object.assign(new Error('Discover could not be refreshed. Please retry.'),{status:502});
   return response.json();
  };
  const authorization=req.headers.authorization||'';
  // the scheduled job and admins skip the "refreshed recently" window (never the lock)
  const scheduled=!!process.env.CRON_SECRET&&authorization===`Bearer ${process.env.CRON_SECRET}`;
  const admin=!scheduled&&/^Bearer \S+$/.test(authorization)&&await call('is_admin',{},authorization).catch(()=>false)===true;
  const result=await refreshDiscover({force:scheduled||admin,rpc:(name,body)=>call(name,{...body,secret})});
  res.setHeader('Cache-Control','no-store');res.status(200).json(result);
 }catch(error){fail(res,error);}
}
