import { useState } from 'react';
import { Orb } from '../components/ui';
import { useApp } from '../lib/store';
import { api,isTauri,errorText } from '../lib/api';
import { STARTERS } from '../lib/langs';
export function TagalogOnboarding() {
  const [name,setName]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const start=async()=>{setBusy(true);try {const app=useApp.getState();await app.setSetting('lang','tl');await app.setSetting('langs','tl');await app.setSetting('user_name',name.trim());await app.setSetting('seen_version',app.info?.version ?? '0.1.0');
    const lessons=await api().lessonsList('tl');let id=lessons[0]?.id;
    if(!id)id=await api().lessonCreate({lang:'tl',title:STARTERS.tl.title,text:STARTERS.tl.text,collection:'Start here'});
    await app.setSetting('onboarded','1');app.setReplay(false);app.bumpLibrary();app.openLesson(id);
  }catch(e){setError(errorText(e));}finally{setBusy(false);}};
  return <main className="tagalog-welcome"><div className="welcome-glow"/><div className="welcome-copy"><Orb size={64}/><p className="eyebrow">WIKANG TAGALOG</p><h1>A little more Tagalog.<br/><em>Every day.</em></h1><p>Read stories, listen to real voices, and make new words your own. One language. Your pace.</p><label>Your name <span className="muted">(optional)</span><input value={name} maxLength={60} onChange={e=>setName(e.target.value)} placeholder="What should we call you?" autoComplete="given-name"/></label><button className="btn primary lg" disabled={busy} onClick={()=>void start()}>{busy?'Preparing your first lesson…':'Start learning'}</button>{error&&<p role="alert">{error}</p>}<small>{isTauri?'Import and transcribe locally. Publish lessons with an admin account.':'No account needed to start. Sign in later to save your learning across devices.'}</small></div><div className="welcome-note"><span>Magandang araw.</span><p>A beautiful day.<br/>A good place to begin.</p></div></main>;
}
