// The desktop app's installer, straight from the latest published GitHub release: Windows
// gets the setup program, a Mac the disk image. The website's download buttons link here, so the
// download starts at once, without a visit to GitHub. Drafts are never served.
const REPO='jaimielovett/wikang-tagalog';
/** The installer a platform downloads, among a release's files. */
export function pickAsset(assets,platform) {
 const want=platform==='mac'?/_aarch64\.dmg$/:platform==='windows'?/_x64-setup\.exe$/:null;
 return want?assets.find(a=>want.test(a.name))?.browser_download_url ?? null:null;
}
/** The platform a browser runs on, when the link doesn't say. */
export function platformOf(userAgent='') {
 if(/iPhone|iPad|Android/i.test(userAgent))return null;
 if(/Windows/i.test(userAgent))return 'windows';
 if(/Macintosh|Mac OS X/i.test(userAgent))return 'mac';
 return null;
}
export default async function handler(req,res,fetcher=fetch) {
 if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).json({error:'GET required.'});
 const asked=String(req.query?.platform ?? '');
 const platform=['mac','windows'].includes(asked)?asked:platformOf(req.headers['user-agent']);
 let url=null;
 try {
  const response=await fetcher(`https://api.github.com/repos/${REPO}/releases/latest`,{headers:{Accept:'application/vnd.github+json','User-Agent':'wikangtagalog.com'},signal:AbortSignal.timeout(8000)});
  if(response.ok)url=pickAsset((await response.json()).assets ?? [],platform);
 } catch {}
 // no installer for this platform (or nothing published yet): back to the site, which says so
 res.setHeader('Cache-Control',url&&asked?'public, s-maxage=600, stale-while-revalidate=3600':'no-store');
 res.redirect(302,url ?? `/?unavailable=${platform ?? 'computer'}`);
}
