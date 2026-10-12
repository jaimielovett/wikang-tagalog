import { cloud, useAccount } from './cloud';
import { readSnapshot,writeSnapshot } from './idb';
import type { Db } from './local';
export const emptyDb = (): Db => ({settings:{lang:'tl',langs:'tl',ui_lang:'en'},lessons:[],terms:{},activity:{},nextId:1,installed:[]});
export function storageKey() { return `wikang-tagalog:${useAccount.getState().session?.user.id ?? 'guest'}`; }
export interface Snapshot { data: Db; revision: number; dirty: boolean }
export function privateSnapshot(db: Db): Db {
  // Desktop and browser API keys must never enter a shared database or backup.
  return {...db, settings: Object.fromEntries(Object.entries(db.settings).filter(([k]) => !/key|token|secret|password/i.test(k)))};
}
export async function openDb() {
  const key = storageKey();
  let snapshot: Snapshot = {data:emptyDb(),revision:0,dirty:false};
  const saved = await readSnapshot<Snapshot>(key);
  if (saved) snapshot = saved;
  const user = useAccount.getState().session?.user;
  if (cloud && user) {
    const {data, error} = await cloud.from('learner_state').select('data,revision').eq('user_id',user.id).maybeSingle();
    if (error) useAccount.setState({sync:'Offline — saved on this device'});
    else if (data) {
      useAccount.setState({sync:snapshot.dirty ? "Saving…" : "Synced"});
      if (snapshot.dirty && snapshot.revision !== data.revision) {
        useAccount.setState({sync:'Sync conflict — export this device’s backup before restoring the cloud copy'});
        // Keep all unsent local work, and refuse to overwrite another device.
      } else if (!snapshot.dirty) snapshot = {data:data.data as Db,revision:data.revision,dirty:false};
    }
  }
  return {snapshot,key};
}
export function persistence(key: string, snapshot: Snapshot) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sending = false;
  let generation = 0;
  let conflict = false;
  const write = () => writeSnapshot(key,snapshot);
  const flush = async () => {
    const user = useAccount.getState().session?.user;
    if (!cloud || !user || storageKey() !== key || conflict || sending || !snapshot.dirty) return;
    sending = true;
    const current = generation;
    useAccount.setState({sync:'Saving…'});
    try {
      const {data,error} = await cloud.rpc('save_learner_state',{expected_revision:snapshot.revision,new_data:privateSnapshot(snapshot.data)});
      if (error) {
        conflict = error.message.includes('sync_conflict');
        throw error;
      }
      snapshot.revision = Number(data);
      snapshot.dirty = generation !== current;
      await write();
      useAccount.setState({sync:snapshot.dirty?'Saving…':'Synced'});
    } catch {
      useAccount.setState({sync:conflict?'Sync conflict — export a backup in Settings':'Offline — saved on this device'});
    } finally {
      sending=false;
      if (snapshot.dirty && !conflict) timer=setTimeout(() => void flush(),5000);
    }
  };
  window.addEventListener('online',() => void flush());
  window.addEventListener('pagehide',() => {void write();});
  if (snapshot.dirty) timer=setTimeout(() => void flush(),1000);
  return {async commit() {generation++; snapshot.dirty=true;await write(); clearTimeout(timer);timer=setTimeout(() => void flush(),700);},flush};
}
