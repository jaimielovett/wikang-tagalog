import {authenticate,parseBody,buildMessages,fail} from '../server/services.mjs';
export default async function handler(req,res) {
 if(req.method!=='POST')return res.status(405).json({error:'POST required.'});
 try {
  const body=parseBody(req);const messages=buildMessages(body.task,body.input||{},body.ui);
  await authenticate(req);
  if(!process.env.AI_API_KEY||!process.env.AI_MODEL)throw Object.assign(new Error('AI is not connected yet. Dictionary lookup is available.'),{status:503});
  const url=new URL(process.env.AI_API_URL||'https://api.openai.com/v1');if(url.protocol!=='https:')throw new Error('AI endpoint must use HTTPS.');
  const response=await fetch(url.href.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.AI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.AI_MODEL,messages,max_tokens:2000,temperature:0.4}),signal:AbortSignal.timeout(50000)});
  if(!response.ok)throw Object.assign(new Error('The AI provider is unavailable. Please try again later.'),{status:502});
  const data=await response.json();const text=data.choices?.[0]?.message?.content;if(typeof text!=='string')throw new Error('Empty AI response.');
  res.setHeader('Cache-Control','no-store');res.status(200).json({text});
 }catch(error){fail(res,error);}
}
