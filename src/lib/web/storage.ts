import { cloud, useAccount } from './cloud';
import { deleteSnapshot,readSnapshot,writeSnapshot } from './idb';
import { hasLearning,mergeGuest } from './merge';
import { applyRows,fingerprint,newSyncState,syncOnce,type Remote,type RemoteRow,type SyncState } from './sync';
import type { Db } from './local';
export const emptyDb = (): Db => ({settings:{lang:'tl',langs:'tl',ui_lang:'en'},lessons:[],terms:{},activity:{},nextId:1,installed:[]});
const GUEST_KEY = 'wikang-tagalog:guest';
export function storageKey() { return useAccount.getState().session ? `wikang-tagalog:${useAccount.getState().session!.user.id}` : GUEST_KEY; }
/** Fired when other devices' changes arrive: the app re-reads what it shows. */
export const REMOTE_CHANGE = 'wikang:remote-change';

export interface Snapshot {
  data: Db;
  /** item-by-item sync (signed in) */
  sync?: SyncState;
  /** this browser's name in the account's activity records */
  device?: string;
  /** the local data has been reconciled with the account once */
  synced?: boolean;
  /** a restored backup: it replaces the account's data everywhere */
  replace?: boolean;
  /** before item-by-item sync: unsent changes on top of the saved document */
  dirty?: boolean;
  revision?: number;
}
export function privateSnapshot(db: Db): Db {
  // Desktop and browser API keys must never enter a shared database or backup.
  return {...db, settings: Object.fromEntries(Object.entries(db.settings).filter(([k]) => !/key|token|secret|password/i.test(k)))};
}
/** Replaces the data in place: the local API keeps its reference to `target`. */
function replaceDb(target: Db, source: Db) {
  for (const k of Object.keys(target)) delete (target as unknown as Record<string, unknown>)[k];
  Object.assign(target, emptyDb(), structuredClone(source));
}
const setSync = (sync: string) => useAccount.setState({sync});
/** Fired when the server no longer accepts this version's data: the app asks for a reload. */
export const UPDATE_REQUIRED = 'wikang:update-required';
/** What a failed sync tells the learner. */
function syncFailed(e: unknown) {
  const message = String((e as Error)?.message ?? e);
  if (message.includes('update_required')) {setSync('A newer version of Wikang Tagalog is needed to sync');window.dispatchEvent(new Event(UPDATE_REQUIRED));}
  else if (message.includes('storage_full')) setSync('Storage full — remove some lessons to keep syncing');
  else setSync('Offline — saved on this device');
}

function remoteFor(userId: string): Remote {
  return {
    async push(rows) {
      const {error} = await cloud!.rpc('push_learner_records',{records:rows});
      if (error) throw new Error(error.message);
    },
    async pull(since) {
      const out: RemoteRow[] = [];
      for (let after = since;;) {
        let query = cloud!.from('learner_records').select('key,data,updated_at,server_at').eq('user_id',userId).order('server_at').limit(1000);
        if (after) query = query.gt('server_at',after);
        const {data,error} = await query;
        if (error) throw new Error(error.message);
        out.push(...(data as RemoteRow[]));
        if (data.length < 1000) return out;
        after = data[data.length-1].server_at;
      }
    },
  };
}
const ownKey = (key: string, device: string) => !key.startsWith('activity:') || key.endsWith(`:${device}`);

/**
 * Brings this browser's data and the account together, once: a restored backup replaces the
 * account's data; a first sync on this browser takes the account's (or, the first time the
 * account syncs item by item, its saved document); learning done as a guest joins in.
 */
async function reconcile(snapshot: Snapshot, key: string, userId: string) {
  const db = snapshot.data;const device = snapshot.device!;const remote = remoteFor(userId);
  let guestJoined = false;
  if (snapshot.replace) {
    const state = snapshot.sync = newSyncState();
    const rows = await remote.pull(null);
    const now = Date.now();
    for (const row of rows) {
      if (!state.pulled_at || row.server_at > state.pulled_at) state.pulled_at = row.server_at;
      if (row.data === null) continue;
      // the backup's activity already counts every device: their records are cleared
      if (ownKey(row.key,device)) state.shadow[row.key] = [fingerprint(row.data),Date.parse(row.updated_at)];
      else state.pending[row.key] = [0,now];
    }
  } else if (!snapshot.synced) {
    snapshot.sync = newSyncState();
    const rows = await remote.pull(null);
    let base: Db | null = null;
    if (rows.length) {
      base = emptyDb();
      applyRows(base,snapshot.sync,device,rows);
    } else {
      // the first sync of this account: its saved document becomes records
      const {data,error} = await cloud!.from('learner_state').select('data').eq('user_id',userId).maybeSingle();
      if (error) throw new Error(error.message);
      if (data?.data) base = {...emptyDb(),...(data.data as Db)};
    }
    // changes this browser had not sent yet are kept, joined like a guest's learning
    if (base) replaceDb(db,snapshot.dirty ? mergeGuest(base,db) : base);
  }
  // learning done as a guest joins the account the first time it signs in on this browser
  const guest = await readSnapshot<Snapshot>(GUEST_KEY);
  if (hasLearning(guest?.data)) {replaceDb(db,mergeGuest(db,guest.data));guestJoined = true;}
  snapshot.synced = true;
  delete snapshot.replace;delete snapshot.dirty;delete snapshot.revision;
  await syncOnce(db,snapshot.sync!,device,remote);
  await writeSnapshot(key,snapshot);
  if (guestJoined) await deleteSnapshot(GUEST_KEY);
}

export async function openDb() {
  const key = storageKey();
  const saved = await readSnapshot<Snapshot>(key);
  const snapshot: Snapshot = saved ?? {data:emptyDb()};
  snapshot.data = {...emptyDb(),...snapshot.data};
  snapshot.device ??= crypto.randomUUID().replace(/-/g,'').slice(0,12);
  const user = useAccount.getState().session?.user;
  if (cloud && user) {
    snapshot.sync ??= newSyncState();
    try {
      if (!snapshot.synced || snapshot.replace) await reconcile(snapshot,key,user.id);
      else await syncOnce(snapshot.data,snapshot.sync,snapshot.device,remoteFor(user.id));
      setSync('Synced');
    } catch (e) {
      syncFailed(e);
    }
  }
  return {snapshot,key};
}

export function persistence(key: string, snapshot: Snapshot) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;let again = false;
  const write = () => writeSnapshot(key,snapshot);
  const cycle = async () => {
    const user = useAccount.getState().session?.user;
    if (!cloud || !user || storageKey() !== key || !snapshot.sync) return;
    if (running) {again = true;return;}
    running = true;
    try {
      let changed: boolean;
      if (!snapshot.synced || snapshot.replace) {await reconcile(snapshot,key,user.id);changed = true;}
      else {
        if (Object.keys(snapshot.sync.pending).length) setSync('Saving…');
        changed = await syncOnce(snapshot.data,snapshot.sync,snapshot.device!,remoteFor(user.id));
        await write();
      }
      setSync('Synced');
      if (changed) window.dispatchEvent(new Event(REMOTE_CHANGE));
    } catch (e) {
      syncFailed(e);
      clearTimeout(timer);timer = setTimeout(() => void cycle(),15000);
    } finally {
      running = false;
      if (again) {again = false;void cycle();}
    }
  };
  // other devices' changes arrive every minute while the app is in view, and when it comes back
  setInterval(() => {if (document.visibilityState === 'visible') void cycle();},60_000);
  document.addEventListener('visibilitychange',() => {if (document.visibilityState === 'visible') void cycle();});
  window.addEventListener('online',() => void cycle());
  window.addEventListener('pagehide',() => {void write();});
  if (snapshot.sync && !snapshot.synced) timer = setTimeout(() => void cycle(),5000);
  return {async commit() {await write();clearTimeout(timer);timer = setTimeout(() => void cycle(),700);},flush:cycle};
}
