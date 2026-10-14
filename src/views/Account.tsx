import { useEffect,useState } from 'react';
import { cloud,useAccount,initAccount } from '../lib/web/cloud';
import { api,isTauri,errorText } from '../lib/api';
import { useApp } from '../lib/store';
import { preparePublication,queue,publish,removeDraft } from '../lib/web/publishing';
import { adoptPublished,type PublishedLesson } from '../lib/web/catalogue';
import { confirmAsk } from '../lib/dialogs';
import type { LessonSummary } from '../lib/types';
import { Icon } from '../components/Icon';
import { Orb, Segmented } from '../components/ui';
import { Avatar } from '../components/Avatar';
import { DiscoverSourcesAdmin } from './DiscoverSourcesAdmin';
export function Account({embedded=false,mode:startMode='signin'}:{embedded?:boolean;mode?:'signin'|'signup'}) {
 const account=useAccount();const [mode,setMode]=useState<'signin'|'signup'>(startMode);const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [message,setMessage]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [drafts,setDrafts]=useState<PublishedLesson[]>([]);const [lessons,setLessons]=useState<LessonSummary[]>([]);const [picked,setPicked]=useState('');const [stage,setStage]=useState('');const [rights,setRights]=useState<Record<string,boolean>>({});
 const load=async()=>{if(!account.admin)return;try{setDrafts(await queue());setLessons(await api().lessonsList('tl'));}catch(e){setError(errorText(e));}};
 useEffect(()=>{void load();},[account.admin]);
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError(errorText(e));}finally{setBusy(false);setStage('');}};
 const signin=(signup=false)=>void run(async()=>{if(!cloud)return;const {error,data}=signup?await cloud.auth.signUp({email,password}):await cloud.auth.signInWithPassword({email,password});if(error)throw error;if(data.session){await initAccount();location.reload();}else setMessage('Check your email to confirm your account, then sign in.');});
 const prepare=()=>void run(async()=>{await preparePublication(Number(picked),(stage,pct)=>setStage(`${stage} ${Math.round(pct)}%`));await load();setMessage('Prepared lesson added to the review queue. Preview it before publishing.');});
 const preview=(row:PublishedLesson)=>void run(async()=>{const id=await adoptPublished(api(),row.id);useApp.getState().bumpLibrary();useApp.getState().openLesson(id);});
  const auth=<section className="auth-panel">
   <Orb size={40}/>
   <h1 className="display">{!embedded?'Take your Tagalog with you':mode==='signup'?'Create your account':'Welcome back'}</h1>
   <p className="auth-lead">{isTauri?(mode==='signup'?'An account keeps your learning in sync with the web: lessons you make here from videos and podcasts appear in your library there.':'Sign in to sync this computer with your account: lessons you make here appear in your library on the web.'):mode==='signup'?'An account keeps your private learning in sync across browsers and devices.':'Sign in to keep your private learning in sync across browsers and devices.'}</p>
   {!cloud?<p className="auth-note"><Icon name="cloud" size={15}/>Accounts aren't connected yet. You can read, import text and build your vocabulary on this device in the meantime.</p>:<>
    <form className="auth-form" onSubmit={e=>{e.preventDefault();signin(mode==='signup');}}>
     <Segmented id="auth-mode" label="Account" value={mode} onChange={v=>{setMode(v);setError('');setMessage('');}} options={[{value:'signin',label:'Sign in'},{value:'signup',label:'Create an account'}]}/>
     <div className="field"><label htmlFor="auth-email">Email</label><input id="auth-email" className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com"/></div>
     <div className="field"><label htmlFor="auth-password">Password</label><input id="auth-password" className="input" type="password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)} required autoComplete={mode==='signup'?'new-password':'current-password'}/>{mode==='signup'&&<span className="auth-hint">At least 8 characters.</span>}</div>
     {error&&<div className="auth-error" role="alert"><Icon name="ban" size={15}/><span>{error}</span></div>}
     {message&&<p className="auth-message" role="status">{message}</p>}
     <button className="btn primary glow lg auth-submit" disabled={busy}>{busy?'One moment…':mode==='signup'?'Create my account':'Sign in'}</button>
    </form>
    <p className="auth-note"><Icon name="cloud" size={15}/>{isTauri?'Anything you learnt on this computer joins your account when you sign in.':'Anything you learnt as a guest in this browser joins your account when you sign in.'}</p>
   </>}
  </section>;
 if(embedded)return auth;
 return <div className="view"><div className="view-inner account-page">
  {!account.session?auth:<section className="auth-panel signed-in">
   <Avatar size={56}/>
   <h1 className="display">Your account</h1>
   <p className="auth-lead">{account.session.user.email}</p>
   <div className="auth-status"><span className="dot ok"/>{account.sync}{account.admin&&<span className="admin-badge">Admin publisher</span>}</div>
   {error&&<div className="auth-error" role="alert"><Icon name="ban" size={15}/><span>{error}</span></div>}
   <div className="form-actions"><button className="btn soft" onClick={()=>useApp.getState().openSettings('profile')}>Edit profile</button><button className="btn outline" disabled={busy} onClick={()=>void run(async()=>{await cloud!.auth.signOut();location.reload();})}>Sign out</button></div>
  </section>}
  {account.session&&message&&<p className="auth-message" role="status">{message}</p>}
 {account.admin&&cloud&&<DiscoverSourcesAdmin/>}
 {account.admin&&<section className="admin-publishing"><h2>Publishing studio</h2><p>Prepare a local lesson, check the transcript and playback, then publish it to the shared Discover catalogue.</p>{isTauri?<div className="settings-card"><label>Local Tagalog lesson<select value={picked} onChange={e=>setPicked(e.target.value)}><option value="">Choose a completed import…</option>{lessons.map(l=><option key={l.id} value={l.id}>{l.title}</option>)}</select></label><button className="btn primary" disabled={!picked||busy} onClick={prepare}>{busy&&stage?stage:'Prepare for review'}</button></div>:<div className="desktop-note"><p>Prepare video and audio in the desktop app. You can review and publish the finished lessons here.</p></div>}
 <div className="form-actions"><h3>Review queue</h3><button className="btn outline" disabled={busy} onClick={()=>void load()}>Refresh queue</button></div>{!drafts.length&&<p className="muted">No lessons awaiting publication.</p>}{drafts.map(row=><article className="settings-card review-card" key={row.id}><span className="eyebrow">{row.status} · {row.kind}</span><h3>{row.title}</h3><p>{row.text.slice(0,180)}…</p><div className="form-actions"><label>Level from<select value={row.lo} disabled={busy} onChange={e=>setDrafts(d=>d.map(r=>r.id===row.id?{...r,lo:Number(e.target.value),hi:Math.max(r.hi,Number(e.target.value))}:r))}>{['A1','A2','B1','B2','C1'].map((l,i)=><option key={l} value={i+1}>{l}</option>)}</select></label><label>Level to<select value={row.hi} disabled={busy} onChange={e=>setDrafts(d=>d.map(r=>r.id===row.id?{...r,hi:Number(e.target.value)}:r))}>{['A1','A2','B1','B2','C1'].map((l,i)=>i+1>=row.lo&&<option key={l} value={i+1}>{l}</option>)}</select></label><label>Shelf<select value={row.shelf} disabled={busy} onChange={e=>setDrafts(d=>d.map(r=>r.id===row.id?{...r,shelf:e.target.value as PublishedLesson['shelf']}:r))}>{['learn','news','culture','music'].map(s=><option key={s}>{s}</option>)}</select></label></div><label className="check-label"><input type="checkbox" checked={!!rights[row.id]} onChange={e=>setRights({...rights,[row.id]:e.target.checked})}/>I have permission to share this transcript and media publicly.</label><div className="form-actions"><button className="btn outline" disabled={busy||row.status!=='review'} onClick={()=>preview(row)}>Preview lesson</button><button className="btn primary" disabled={busy||row.status!=='review'||!rights[row.id]} onClick={()=>void run(async()=>{const {error}=await cloud!.from('published_lessons').update({lo:row.lo,hi:row.hi,shelf:row.shelf}).eq('id',row.id);if(error)throw error;await publish(row,!!rights[row.id]);await load();setMessage('Published. This lesson is now available in Discover.');})}>Publish to Discover</button><button className="btn outline" disabled={busy} onClick={()=>void run(async()=>{if(!await confirmAsk('Delete this unpublished draft and its uploaded media?'))return;await removeDraft(row.id);await load();})}>Delete draft</button></div></article>)}</section>}
 </div></div>;
}
