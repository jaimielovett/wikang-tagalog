import { useEffect,useState } from 'react';
import { Icon,type IconName } from './Icon';
import { Orb } from './ui';
import { api,isTauri } from '../lib/api';
import { useApp,type View } from '../lib/store';
import { useAccount } from '../lib/web/cloud';
import { t } from '../lib/i18n';
import type { LessonSummary } from '../lib/types';
const nav:{view:View;name:string;icon:IconName}[]=[{view:'library',name:'Library',icon:'library'},{view:'discover',name:'Discover',icon:'sparkle'},{view:'playlists',name:'Playlists',icon:'playlist'},{view:'reader',name:'Now reading',icon:'book'},{view:'chat',name:'Chat',icon:'chat'},{view:'vocab',name:'Vocabulary',icon:'cards'},{view:'progress',name:'Progress',icon:'chart'}];
export function Sidebar() {
  const {view,go,openImport,knownCount,lessonId,libraryVersion,openLesson,streak}=useApp();
  const account=useAccount();const [recent,setRecent]=useState<LessonSummary[]>([]);
  useEffect(()=>{void api().lessonsList('tl').then(l=>setRecent(l.filter(x=>x.opened_at).slice(0,4)));},[libraryVersion,lessonId]);
  return <aside className="sidebar" aria-label="Navigation"><div className="brand"><Orb size={25}/><span className="brand-name">Wikang<br/>Tagalog</span></div>
    <div className="tagalog-identity"><span className="lang-badge">TL</span><div><strong>Tagalog</strong><span>{knownCount.toLocaleString()} {t('mots connus','known words')}</span></div></div>
    <nav className="nav">{nav.map(n=><button key={n.view} aria-label={n.name} className={`nav-item ${view===n.view?'active':''}`} aria-current={view===n.view?'page':undefined} disabled={n.view==='reader'&&!lessonId} onClick={()=>go(n.view)}><Icon name={n.icon}/><span>{n.name}</span>{n.view==='progress'&&!!streak?.current&&<span className="num">{streak.current} 🔥</span>}</button>)}
      <button aria-label="Settings" className={`nav-item ${view==='settings'?'active':''}`} onClick={()=>go('settings')}><Icon name="settings"/><span>Settings</span></button>
      <button aria-label={account.session?"Account":"Sign in"} className={`nav-item ${view==='account'?'active':''}`} onClick={()=>go('account')}><Icon name="user"/><span>{account.session?'Account':'Sign in'}</span>{account.admin&&<span className="admin-badge">Admin</span>}</button>
    </nav><button className="btn soft side-import" onClick={()=>openImport()}><Icon name="plus"/>Import a lesson</button>
    {!!recent.length&&<div className="side-recent"><div className="side-section">Recently opened</div>{recent.map(r=><button key={r.id} onClick={()=>openLesson(r.id)}>{r.title}</button>)}</div>}
    <div className="sidebar-bottom"><span className="muted">{isTauri?'Desktop · local transcription':'Web · learn anywhere'}</span><small role="status">{account.sync}</small></div>
  </aside>;
}
