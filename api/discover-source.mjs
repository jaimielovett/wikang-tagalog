import {allowDesktop,authenticate,parseBody,inputText,fail} from '../server/services.mjs';
import {findSource,learnerSources,readSource} from '../server/discover.mjs';
// A learner's own Discover sources: find the feed behind a pasted address, or read their sources.
// Each request counts against the learner's daily budget; nothing read here is stored on the server.
export default async function handler(req,res) {
 if(allowDesktop(req,res))return;
 if(req.method!=='POST')return res.status(405).json({error:'POST required.'});
 try {
  const body=parseBody(req);
  if(body.action==='find') {
   const url=inputText(body.url,2000);
   await authenticate(req);
   res.setHeader('Cache-Control','no-store');return res.status(200).json(await findSource(url));
  }
  if(body.action==='read') {
   const sources=learnerSources(body.sources);
   await authenticate(req);
   const results=await Promise.all(sources.map(source=>readSource(source).then(items=>({id:source.id,items}),error=>({id:source.id,items:[],error:String(error?.message??error).slice(0,300)}))));
   res.setHeader('Cache-Control','no-store');return res.status(200).json({results});
  }
  throw Object.assign(new Error('Unknown operation.'),{status:400});
 }catch(error){fail(res,error);}
}
