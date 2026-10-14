// Item-by-item sync: each setting, lesson, word, playlist and chat is its own record, and the
// newest change wins per record. A device's daily activity is its own record, added up with
// the other devices'. Nothing here touches the network or storage: `Remote` is given, so two
// devices can be simulated in a test.
import type { Db } from "./local";
import type { DayStat } from "../types";

/** Format of the records this code writes. */
export const RECORD_VERSION = 1;
/** Settings that never leave the device (keys for online services). */
const SECRET = /key|token|secret|password/i;

type Day = DayStat & { lang: string };
export interface RemoteRow {
  key: string;
  data: unknown | null;
  updated_at: string;
  server_at: string;
}
export interface PushRow {
  key: string;
  data: unknown | null;
  updated_at: string;
  version: number;
}
export interface Remote {
  push(rows: PushRow[]): Promise<void>;
  /** rows changed since `since` (server time), oldest first */
  pull(since: string | null): Promise<RemoteRow[]>;
}
export interface SyncState {
  v: 2;
  /** last value known to the server: key → [fingerprint (0: deleted), change time in ms] */
  shadow: Record<string, [number, number]>;
  /** local changes not yet sent: key → [fingerprint, time first seen in ms] */
  pending: Record<string, [number, number]>;
  /** newest server time pulled */
  pulled_at: string | null;
  /** other devices' activity: "day|lang" → device → their day */
  others: Record<string, Record<string, Day>>;
}
export const newSyncState = (): SyncState => ({ v: 2, shadow: {}, pending: {}, pulled_at: null, others: {} });

/** A 53-bit fingerprint (cyrb53); never 0, which marks a deleted record. */
export function fingerprint(value: unknown): number {
  if (value === undefined || value === null) return 0;
  const str = JSON.stringify(value);
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0) || 1;
}

// ---------- daily activity, per device ----------

const COUNTS = ["words_read", "known_added", "lingqs", "listen_secs", "learn_secs"] as const;
function plus(a: Day, b: Day): Day {
  const out = { ...a, goal_met: a.goal_met || b.goal_met };
  for (const f of COUNTS) out[f] = (a[f] ?? 0) + (b[f] ?? 0);
  return out;
}
function minus(a: Day, b: Day): Day {
  const out = { ...a };
  for (const f of COUNTS) out[f] = Math.max(0, (a[f] ?? 0) - (b[f] ?? 0));
  return out;
}
const othersSum = (state: SyncState, k: string): Day | null => Object.values(state.others[k] ?? {}).reduce<Day | null>((sum, d) => (sum ? plus(sum, d) : d), null);
/** This device's share of a day: everything shown, minus what the other devices did. */
function ownDay(db: Db, state: SyncState, k: string): Day | null {
  const shown = db.activity[k];
  if (!shown) return null;
  const others = othersSum(state, k);
  const own = others ? minus(shown, others) : shown;
  return COUNTS.some((f) => (own[f] ?? 0) > 0) || own.goal_met ? own : null;
}
const activityKey = (key: string) => {
  const rest = key.slice("activity:".length);
  const at = rest.lastIndexOf(":");
  return { day: rest.slice(0, at), device: rest.slice(at + 1) };
};

// ---------- records ----------

/** Every record this device writes, by key. */
export function recordsOf(db: Db, state: SyncState, device: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(db.settings)) if (!SECRET.test(k)) out.set(`setting:${k}`, v);
  for (const l of db.lessons) out.set(`lesson:${l.id}`, l);
  for (const [k, t] of Object.entries(db.terms)) out.set(`term:${k}`, t);
  for (const p of db.playlists ?? []) out.set(`playlist:${p.id}`, p);
  for (const c of db.chats ?? []) out.set(`chat:${c.id}`, c);
  for (const k of Object.keys(db.activity)) {
    const own = ownDay(db, state, k);
    if (own) out.set(`activity:${k}:${device}`, own);
  }
  return out;
}

/** One record's current local value (null if absent). */
export function recordFor(db: Db, state: SyncState, device: string, key: string): unknown {
  const at = key.indexOf(":");
  const kind = key.slice(0, at);
  const id = key.slice(at + 1);
  switch (kind) {
    case "setting":
      return SECRET.test(id) ? null : (db.settings[id] ?? null);
    case "lesson":
      return db.lessons.find((l) => l.id === Number(id)) ?? null;
    case "term":
      return db.terms[id] ?? null;
    case "playlist":
      return db.playlists?.find((p) => p.id === Number(id)) ?? null;
    case "chat":
      return db.chats?.find((c) => c.id === Number(id)) ?? null;
    case "activity": {
      const { day, device: owner } = activityKey(key);
      return owner === device ? ownDay(db, state, day) : (state.others[day]?.[owner] ?? null);
    }
    default:
      return null;
  }
}

function replaceById<T extends { id: number }>(list: T[], id: number, value: T | null): T[] {
  const rest = list.filter((x) => x.id !== id);
  return value ? [...rest, value] : rest;
}

/** Applies a record from the server to the local data. */
export function applyRecord(db: Db, state: SyncState, device: string, key: string, data: unknown | null) {
  const at = key.indexOf(":");
  const kind = key.slice(0, at);
  const id = key.slice(at + 1);
  switch (kind) {
    case "setting":
      if (SECRET.test(id)) return;
      if (data === null) delete db.settings[id];
      else db.settings[id] = String(data);
      return;
    case "lesson": {
      const n = Number(id);
      // the list keeps its order: a lesson that changed stays where it was
      const i = db.lessons.findIndex((l) => l.id === n);
      if (data === null) db.lessons = db.lessons.filter((l) => l.id !== n);
      else if (i >= 0) db.lessons[i] = data as Db["lessons"][number];
      else db.lessons.push(data as Db["lessons"][number]);
      db.nextId = Math.max(db.nextId, n + 1);
      return;
    }
    case "term":
      if (data === null) delete db.terms[id];
      else db.terms[id] = data as Db["terms"][string];
      return;
    case "playlist":
      db.playlists = replaceById(db.playlists ?? [], Number(id), data as NonNullable<Db["playlists"]>[number] | null);
      return;
    case "chat":
      db.chats = replaceById(db.chats ?? [], Number(id), data as NonNullable<Db["chats"]>[number] | null);
      return;
    case "activity": {
      const { day, device: owner } = activityKey(key);
      // what this device did that day stays; the owner's share is replaced
      const own = ownDay(db, state, day);
      if (owner === device) {
        const others = othersSum(state, day);
        const mine = data as Day | null;
        const total = mine && others ? plus(mine, others) : (mine ?? others);
        if (total) db.activity[day] = total;
        else delete db.activity[day];
        return;
      }
      const slot = (state.others[day] ??= {});
      if (data === null) delete slot[owner];
      else slot[owner] = data as Day;
      const others = othersSum(state, day);
      const total = own && others ? plus(own, others) : (own ?? others);
      if (total) db.activity[day] = total;
      else delete db.activity[day];
      return;
    }
  }
}

/** Notes local changes since the last sync: new or changed records, and deleted ones. */
export function detectChanges(db: Db, state: SyncState, device: string, now: number) {
  const current = recordsOf(db, state, device);
  for (const [key, value] of current) {
    const f = fingerprint(value);
    const known = state.pending[key]?.[0] ?? state.shadow[key]?.[0];
    if (known !== f) state.pending[key] = [f, now];
  }
  for (const key of Object.keys(state.shadow)) {
    const own = !key.startsWith("activity:") || activityKey(key).device === device;
    if (own && !current.has(key) && state.shadow[key][0] !== 0 && state.pending[key]?.[0] !== 0) state.pending[key] = [0, now];
  }
  // a change undone before it was sent is no change at all
  for (const [key, [f]] of Object.entries(state.pending)) if (state.shadow[key]?.[0] === f) delete state.pending[key];
}

/**
 * Applies the server's changes since the last pull. The newest change wins:
 * a local edit not yet sent is kept if it is newer than the server's.
 */
export function applyRows(db: Db, state: SyncState, device: string, rows: RemoteRow[]): boolean {
  let changed = false;
  for (const row of rows) {
    if (!state.pulled_at || row.server_at > state.pulled_at) state.pulled_at = row.server_at;
    const time = Date.parse(row.updated_at);
    const own = !row.key.startsWith("activity:") || activityKey(row.key).device === device;
    const local = state.pending[row.key];
    if (own && local) {
      if (local[1] >= time) continue;
      delete state.pending[row.key];
    }
    if (own && state.shadow[row.key] && state.shadow[row.key][1] > time) continue;
    const before = fingerprint(recordFor(db, state, device, row.key));
    applyRecord(db, state, device, row.key, row.data);
    if (own) state.shadow[row.key] = [fingerprint(row.data), time];
    if (fingerprint(recordFor(db, state, device, row.key)) !== before || !own) changed = true;
  }
  return changed;
}

/** Sends pending changes, in batches small enough for one request each. */
export async function pushPending(db: Db, state: SyncState, device: string, remote: Remote) {
  const keys = Object.keys(state.pending);
  let batch: PushRow[] = [];
  let size = 0;
  const sent: [string, [number, number]][] = [];
  const send = async () => {
    if (!batch.length) return;
    await remote.push(batch);
    for (const [key, entry] of sent) {
      state.shadow[key] = entry;
      // changed again while sending: stays pending, with its newer value
      if (state.pending[key]?.[0] === entry[0]) delete state.pending[key];
    }
    batch = [];
    sent.length = 0;
    size = 0;
  };
  for (const key of keys) {
    const entry = state.pending[key];
    const data = entry[0] === 0 ? null : recordFor(db, state, device, key);
    const length = data === null ? 4 : JSON.stringify(data).length;
    if (batch.length && (batch.length >= 500 || size + length > 900_000)) await send();
    batch.push({ key, data, updated_at: new Date(entry[1]).toISOString(), version: RECORD_VERSION });
    sent.push([key, [fingerprint(data), entry[1]]]);
    size += length;
  }
  await send();
}

/**
 * One round: note local changes, take the server's newer ones, send what's left.
 * Returns whether the local data changed (the view should refresh).
 */
export async function syncOnce(db: Db, state: SyncState, device: string, remote: Remote, now = Date.now()): Promise<boolean> {
  detectChanges(db, state, device, now);
  // a little overlap: a change committed just before the last pull may carry an earlier server time
  const since = state.pulled_at ? new Date(Date.parse(state.pulled_at) - 120_000).toISOString() : null;
  const changed = applyRows(db, state, device, await remote.pull(since));
  await pushPending(db, state, device, remote);
  return changed;
}
