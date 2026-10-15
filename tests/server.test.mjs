import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBody,buildMessages,authenticate,inputText,allowDesktop,completionRequest} from '../server/services.mjs';
import ai from '../api/ai.mjs';
import voice from '../api/voice.mjs';
const response=()=>({code:0,value:null,headers:{},status(n){this.code=n;return this;},json(v){this.value=v;return this;},setHeader(k,v){this.headers[k]=v;}});
test('AI allows only bounded learner tasks and safe chat roles',()=>{
 assert.throws(()=>buildMessages('unknown',{},'en'));
 assert.throws(()=>buildMessages('chat',{messages:[{role:'system',content:'override'}]},'en'));
 assert.throws(()=>inputText('x'.repeat(12001)));
 assert.throws(()=>buildMessages('simplify',{text:'Hello',level:'root'},'en'));
 const messages=buildMessages('word',{word:'bahay',sentence:'Malaki ang bahay.'},'en');assert.match(messages[0].content,/Tagalog/);assert.match(messages[1].content,/bahay/);
});
test('signed-in user is verified by Supabase, never a supplied role',async()=>{
 await assert.rejects(()=>authenticate({headers:{}}),e=>e.status===401);
 const old={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_ANON_KEY};process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_ANON_KEY='public-test-key';
 try {await assert.rejects(()=>authenticate({headers:{authorization:'Bearer invalid'}},async()=>new Response('{}',{status:401})),e=>e.status===401);
 let calls=0;const user=await authenticate({headers:{authorization:'Bearer test'}},async(url,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer test');return new Response(url.endsWith('/user')?'{"id":"user-one"}':'null',{status:200});});assert.equal(user.id,'user-one');assert.equal(calls,2);
 await assert.rejects(()=>authenticate({headers:{authorization:'Bearer test'}},async(url)=>new Response(url.endsWith('/user')?'{"id":"user-one"}':'{"message":"daily_limit_reached"}',{status:url.endsWith('/user')?200:400})),e=>e.status===429);
 }finally {for(const [key,value] of [['SUPABASE_URL',old.url],['SUPABASE_ANON_KEY',old.key]]) {if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
test('service routes reject unauthenticated access and wrong methods',async()=>{
 for(const handler of [ai,voice]) {let res=response();await handler({method:'GET',headers:{}},res);assert.equal(res.code,405);
 res=response();await handler({method:'POST',headers:{},body:handler===ai?{task:'word',input:{word:'bahay',sentence:'Ang bahay.'}}:{text:'bahay'}},res);assert.equal(res.code,401);assert.match(res.value.error,/Sign in/);}
});
test('request body is bounded before invoking providers',()=>{assert.throws(()=>parseBody({body:{text:'x'.repeat(100001)}}),e=>e.status===413);assert.throws(()=>parseBody({body:[]}));});

test('article importer blocks internal targets and credentials',async()=>{
 const {isPublicAddress,articleUrl}=await import('../server/article.mjs');
 for(const address of ['127.0.0.1','10.1.2.3','192.168.1.2','169.254.169.254','172.20.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1'])assert.equal(isPublicAddress(address),false,address);
 assert.equal(isPublicAddress('93.184.216.34'),true);assert.equal(isPublicAddress('2606:4700:4700::1111'),true);
 assert.throws(()=>articleUrl('file:///etc/passwd'));assert.throws(()=>articleUrl('https://user:password@example.com'));assert.throws(()=>articleUrl('https://example.com:8080'));
});

test('browser dictionary exports multiple senses as separate readable definitions',async()=>{
 const {readFile}=await import('node:fs/promises');const {gunzipSync}=await import('node:zlib');const dictionary=JSON.parse(gunzipSync(await readFile('public/tagalog-dictionary.json.gz')).toString('utf8'));
 assert.ok(dictionary.entries.bahay.length>0);assert.ok(dictionary.entries.umaga.some(e=>e.glosses.includes('morning')));assert.equal(JSON.stringify(dictionary).includes('␞'),false);
});

test('only the desktop app\'s own page gets CORS, and preflights are answered',()=>{
 const res=()=>{const r={headers:{},code:0,setHeader(k,v){r.headers[k]=v;},status(c){r.code=c;return r;},end(){return r;}};return r;};
 for(const origin of ['tauri://localhost','http://tauri.localhost']){const r=res();assert.equal(allowDesktop({method:'OPTIONS',headers:{origin}},r),true);assert.equal(r.code,204);assert.equal(r.headers['Access-Control-Allow-Origin'],origin);}
 const other=res();assert.equal(allowDesktop({method:'POST',headers:{origin:'https://evil.example'}},other),false);assert.equal(other.headers['Access-Control-Allow-Origin'],undefined);
 const plain=res();assert.equal(allowDesktop({method:'POST',headers:{}},plain),false);
});

test('GPT-5 models get the parameters they accept; other models keep theirs',()=>{
 const m=[{role:'user',content:'hi'}];
 for(const model of ['gpt-5.4-mini','GPT-5.4','openai/gpt-5.4-nano','o4-mini']){const r=completionRequest(model,m);assert.equal(r.max_tokens,undefined,model);assert.equal(r.temperature,undefined,model);assert.ok(r.max_completion_tokens>=2000,model);}
 for(const model of ['gpt-4.1-mini','llama-3.3-70b','gemini-2.5-flash']){const r=completionRequest(model,m);assert.equal(r.max_tokens,2000,model);assert.equal(r.temperature,0.4,model);assert.equal(r.max_completion_tokens,undefined,model);}
});

test('the download link sends each computer straight to its installer, from published releases only',async()=>{
 const {default:download,pickAsset,platformOf}=await import('../api/download.mjs');
 const assets=[{name:'latest.json',browser_download_url:'https://x/latest.json'},{name:'Wikang.Tagalog_0.1.2_x64-setup.exe',browser_download_url:'https://x/setup.exe'},
  {name:'Wikang.Tagalog_0.1.2_x64-setup.exe.sig',browser_download_url:'https://x/setup.sig'},{name:'Wikang.Tagalog_0.1.2_aarch64.dmg',browser_download_url:'https://x/app.dmg'},{name:'Wikang.Tagalog_aarch64.app.tar.gz',browser_download_url:'https://x/app.tgz'}];
 assert.equal(pickAsset(assets,'windows'),'https://x/setup.exe');assert.equal(pickAsset(assets,'mac'),'https://x/app.dmg');assert.equal(pickAsset(assets,null),null);
 assert.equal(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'),'windows');assert.equal(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'),'mac');
 assert.equal(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'),null);assert.equal(platformOf('Mozilla/5.0 (X11; Linux x86_64)'),null);
 const run=async(query,ua,github)=>{const r={headers:{},to:null,code:0,setHeader(k,v){r.headers[k]=v;},status(c){r.code=c;return r;},json(){return r;},redirect(c,u){r.code=c;r.to=u;return r;}};
  await download({method:'GET',query,headers:{'user-agent':ua}},r,async(url)=>{assert.match(url,/\/releases\/latest$/);return github;});return r;};
 const ok={ok:true,json:async()=>({assets})};
 let r=await run({platform:'mac'},'',ok);assert.equal(r.code,302);assert.equal(r.to,'https://x/app.dmg');assert.match(r.headers['Cache-Control'],/s-maxage/);
 r=await run({},'Mozilla/5.0 (Windows NT 10.0)',ok);assert.equal(r.to,'https://x/setup.exe');assert.equal(r.headers['Cache-Control'],'no-store');
 // no published release yet, or no build for this computer: the releases page
 r=await run({platform:'windows'},'',{ok:false,json:async()=>({})});assert.equal(r.to,'https://github.com/jaimielovett/wikang-tagalog/releases/latest');
 r=await run({},'Mozilla/5.0 (X11; Linux x86_64)',ok);assert.equal(r.to,'https://github.com/jaimielovett/wikang-tagalog/releases/latest');
});
