import {authenticate,parseBody,inputText,fail} from '../server/services.mjs';
export default async function handler(req,res) {
 if(req.method!=='POST')return res.status(405).json({error:'POST required.'});
 try {
  const body=parseBody(req);const text=inputText(body.text,4500);if(new TextEncoder().encode(text).length>4500)throw Object.assign(new Error('Use shorter text for pronunciation.'),{status:400});
  await authenticate(req);
  if(!process.env.GOOGLE_TTS_API_KEY)throw Object.assign(new Error('Natural voice is not connected yet. Available device voices can still read aloud.'),{status:503});
  const response=await fetch('https://texttospeech.googleapis.com/v1/text:synthesize',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':process.env.GOOGLE_TTS_API_KEY},body:JSON.stringify({input:{text},voice:{languageCode:'fil-PH',ssmlGender:'FEMALE'},audioConfig:{audioEncoding:body.encoding==='LINEAR16'?'LINEAR16':'MP3',sampleRateHertz:24000,speakingRate:0.95}}),signal:AbortSignal.timeout(50000)});
  if(!response.ok)throw Object.assign(new Error('The voice provider is unavailable. Please retry.'),{status:502});
  const data=await response.json();if(!data.audioContent)throw new Error('Empty voice response.');res.setHeader('Cache-Control','no-store');res.status(200).json({audioContent:data.audioContent});
 }catch(error){fail(res,error);}
}
