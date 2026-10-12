import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {isIP} from 'node:net';
export function isPublicAddress(address) {
 if(isIP(address)===4) {const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||a>=224);}
 // Only globally routable IPv6 unicast; mapped/loopback/link-local/private are rejected.
 return isIP(address)===6 && /^[23]/i.test(address) && !/^2001:db8:/i.test(address);
}
export function articleUrl(value) {
 let url;try{url=new URL(value);}catch{throw Object.assign(new Error('Enter a valid HTTPS article URL.'),{status:400});}
 if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||url.hostname.length>253)throw Object.assign(new Error('Use a public HTTPS article URL.'),{status:400});
 return url;
}
export async function fetchArticle(value,redirects=0) {
 const url=articleUrl(value);const hostname=url.hostname.replace(/^\[|\]$/g,'');
 const addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await lookup(hostname,{all:true});
 if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address)))throw Object.assign(new Error('This address cannot be imported.'),{status:400});
 const pinned=addresses[0];
 const result=await new Promise((resolve,reject)=>{
  const req=request(url,{headers:{'User-Agent':'WikangTagalog/0.1 (+article import)','Accept':'text/html','Accept-Encoding':'identity'},lookup(_hostname,options,callback){if(options.all)callback(null,[pinned]);else callback(null,pinned.address,pinned.family);}},response=>{
   const chunks=[];let size=0;
   response.on('data',chunk=>{size+=chunk.length;if(size>2000000){response.destroy();reject(Object.assign(new Error('This article is too large. Import a document or paste its text.'),{status:413}));}else chunks.push(chunk);});
   response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,html:Buffer.concat(chunks).toString('utf8')}));response.on('error',reject);
  });req.setTimeout(15000,()=>req.destroy(new Error('The article site did not respond.')));req.on('error',reject);req.end();
 });
 if(result.status>=300&&result.status<400&&result.headers.location){if(redirects>=3)throw Object.assign(new Error('Too many article redirects.'),{status:400});return fetchArticle(new URL(result.headers.location,url).href,redirects+1);}
 if(result.status!==200||!result.headers['content-type']?.includes('text/html'))throw Object.assign(new Error('This page cannot be read as an article. Paste its text instead.'),{status:422});
 return {url:url.href,html:result.html};
}
