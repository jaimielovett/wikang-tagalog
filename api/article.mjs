import {authenticate,parseBody,inputText,fail} from '../server/services.mjs';
import {fetchArticle} from '../server/article.mjs';
export default async function handler(req,res) {
 if(req.method!=='POST')return res.status(405).json({error:'POST required.'});
 try {const body=parseBody(req);const url=inputText(body.url,2000);await authenticate(req);const article=await fetchArticle(url);res.setHeader('Cache-Control','no-store');res.status(200).json(article);}catch(error){fail(res,error);}
}
