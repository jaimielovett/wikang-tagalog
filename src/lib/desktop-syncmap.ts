// The desktop's side of item-by-item sync, without Tauri or the network: its database (read and
// written by src-tauri/src/sync.rs with this computer's ids) shown to the shared engine in the
// account's terms, and the account's changes turned back into writes for this computer.
import type { Db } from "./web/local";
import type { DayStat, Term } from "./types";
import { mergeGuest, newMergeIds } from "./web/merge.ts";
import { applyRows, fingerprint, newSyncState, syncOnce, type Remote, type SyncState } from "./web/sync.ts";

type Day = DayStat & { lang: string };
type Lesson = Db["lessons"][number] & { opened_at?: number; media_url?: string };
type Playlist = NonNullable<Db["playlists"]>[number];
type Chat = NonNullable<Db["chats"]>[number];

/** The database as sync.rs exports it (this computer's ids). */
export interface LocalSnapshot {
  settings: Record<string, string>;
  lessons: Lesson[];
  terms: Record<string, Term>;
  activity: Record<string, Day>;
  playlists: Playlist[];
  chats: Chat[];
}
/** One write for sync.rs: a lesson, playlist or chat by this computer's id, or "new:<account id>". */
export interface LocalChange {
  kind: "setting" | "lesson" | "term" | "activity" | "playlist" | "chat";
  key: string;
  data: unknown | null;
}
export interface Created {
  key: string;
  id: number;
}
/** Account id → this computer's id, for lessons, playlists and chats. */
export interface IdMaps {
  lesson: Record<string, number>;
  playlist: Record<string, number>;
  chat: Record<string, number>;
}
export interface DesktopState {
  sync: SyncState;
  device: string;
  ids: IdMaps;
  /** this computer's learning has joined the account once */
  synced: boolean;
}
export const newDesktopState = (device: string): DesktopState => ({ sync: newSyncState(), device, ids: { lesson: {}, playlist: {}, chat: {} }, synced: false });

/** Settings that belong to this computer: its AI, backups, downloads, and where it left off. */
export const DEVICE_SETTING = /^(ai_gpu|asr_model|llm_model|media_quality|youtube_browser|profile_id|seen_version|last_lesson|last_playlist|lang|langs|backup_.*|online_.*)$/;

/** Files on this computer mean nothing elsewhere: only addresses every device can open travel. */
const shared = (path: string | null | undefined) => (path && /^(https?:|data:)/.test(path) ? path : null);

const invert = (m: Record<string, number>) => new Map(Object.entries(m).map(([sync, local]) => [local, Number(sync)]));

/** Ids from the clock, as the web hands out: never the same as another device's. */
function clockIds(taken: Set<number>) {
  let last = 0;
  return () => {
    let id = Math.max(last + 1, Date.now() * 1000 + Math.floor(Math.random() * 1000));
    while (taken.has(id)) id++;
    taken.add(id);
    last = id;
    return id;
  };
}

/** The database in the account's terms. Lessons, playlists and chats new to sync get account ids here. */
export function accountView(local: LocalSnapshot, ids: IdMaps): Db {
  const taken = new Set([...Object.keys(ids.lesson), ...Object.keys(ids.playlist), ...Object.keys(ids.chat)].map(Number));
  const next = clockIds(taken);
  const toSync = (kind: keyof IdMaps) => {
    const known = invert(ids[kind]);
    return (localId: number) => {
      let id = known.get(localId);
      if (id === undefined) {
        id = next();
        ids[kind][String(id)] = localId;
        known.set(localId, id);
      }
      return id;
    };
  };
  const lesson = toSync("lesson");
  const lessonIds = new Map(local.lessons.map((l) => [l.id, lesson(l.id)]));
  const lessonOf = (id: number | null | undefined) => (id == null ? null : (lessonIds.get(id) ?? null));
  const playlist = toSync("playlist");
  const chat = toSync("chat");

  const settings: Record<string, string> = {};
  for (const [k, v] of Object.entries(local.settings)) {
    if (DEVICE_SETTING.test(k)) continue;
    const published = /^published_(\d+)$/.exec(k);
    if (published) {
      const id = lessonOf(Number(published[1]));
      if (id != null) settings[`published_${id}`] = v;
    } else if (k.startsWith("catalogue_")) {
      const id = lessonOf(Number(v));
      if (id != null) settings[k] = String(id);
    } else settings[k] = v;
  }
  const lessons = local.lessons.map((l) => ({
    ...l,
    id: lessonIds.get(l.id)!,
    media_path: shared(l.media_path),
    video_path: shared(l.video_path),
    cover_path: shared(l.cover_path),
  }));
  return {
    settings,
    lessons,
    terms: { ...local.terms },
    activity: structuredClone(local.activity),
    nextId: Math.max(1, ...lessons.map((l) => l.id + 1)),
    installed: [],
    playlists: local.playlists.map((p) => ({ ...p, id: playlist(p.id), lessons: p.lessons.map((l) => lessonOf(l)).filter((l): l is number => l != null), current: lessonOf(p.current) })),
    chats: local.chats.map((c) => ({ ...c, id: chat(c.id), lesson_id: lessonOf(c.lesson_id) })),
  };
}

/** Every record of a view, by key, as a fingerprint (activity as the totals shown here). */
function prints(db: Db): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(db.settings)) out.set(`setting:${k}`, fingerprint(v));
  for (const l of db.lessons) out.set(`lesson:${l.id}`, fingerprint(l));
  for (const [k, t] of Object.entries(db.terms)) out.set(`term:${k}`, fingerprint(t));
  for (const [k, d] of Object.entries(db.activity)) out.set(`activity:${k}`, fingerprint(d));
  for (const p of db.playlists ?? []) out.set(`playlist:${p.id}`, fingerprint(p));
  for (const c of db.chats ?? []) out.set(`chat:${c.id}`, fingerprint(c));
  return out;
}

/** The writes that bring this computer to `view`: lessons first, since playlists and chats may name new ones. */
function writes(before: Map<string, number>, view: Db, ids: IdMaps): { lessons: LocalChange[]; rest: (created: Created[]) => LocalChange[] } {
  const after = prints(view);
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter((k) => before.get(k) !== after.get(k));
  const localOf = (kind: keyof IdMaps, id: string) => ids[kind][id];
  const lessons: LocalChange[] = [];
  const later: string[] = [];
  for (const key of changed) {
    const at = key.indexOf(":");
    const kind = key.slice(0, at);
    const id = key.slice(at + 1);
    if (kind !== "lesson") {
      later.push(key);
      continue;
    }
    const value = view.lessons.find((l) => String(l.id) === id) ?? null;
    const local = localOf("lesson", id);
    if (!value && local === undefined) continue;
    lessons.push({ kind: "lesson", key: local !== undefined ? String(local) : `new:${id}`, data: value });
  }
  const rest = (created: Created[]) => {
    for (const c of created) if (c.key.startsWith("new:")) ids.lesson[c.key.slice(4)] = c.id;
    const lessonLocal = (id: number | null | undefined) => (id == null ? null : (ids.lesson[String(id)] ?? null));
    const out: LocalChange[] = [];
    for (const key of later) {
      const at = key.indexOf(":");
      const kind = key.slice(0, at) as LocalChange["kind"];
      const id = key.slice(at + 1);
      if (kind === "setting") {
        if (DEVICE_SETTING.test(id)) continue;
        const value = view.settings[id] ?? null;
        const published = /^published_(\d+)$/.exec(id);
        if (published) {
          const l = lessonLocal(Number(published[1]));
          if (l != null) out.push({ kind, key: `published_${l}`, data: value });
        } else if (id.startsWith("catalogue_")) {
          const l = value == null ? null : lessonLocal(Number(value));
          if (value == null || l != null) out.push({ kind, key: id, data: value == null ? null : String(l) });
        } else out.push({ kind, key: id, data: value });
      } else if (kind === "term") out.push({ kind, key: id, data: view.terms[id] ?? null });
      else if (kind === "activity") out.push({ kind, key: id, data: view.activity[id] ?? null });
      else if (kind === "playlist" || kind === "chat") {
        const local = localOf(kind, id);
        const value =
          kind === "playlist"
            ? (view.playlists ?? []).find((p) => String(p.id) === id)
            : (view.chats ?? []).find((c) => String(c.id) === id);
        if (!value && local === undefined) continue;
        const data = !value
          ? null
          : kind === "playlist"
            ? { ...value, lessons: (value as Playlist).lessons.map(lessonLocal).filter((l): l is number => l != null), current: lessonLocal((value as Playlist).current) }
            : { ...value, lesson_id: lessonLocal((value as Chat).lesson_id) };
        out.push({ kind, key: local !== undefined ? String(local) : `new:${id}`, data });
      }
    }
    return out;
  };
  return { lessons, rest };
}

/** Carries this computer's ids over when the merge renumbers lessons, playlists or chats. */
function renumber(map: Record<string, number>, moved: Map<number, number>) {
  const before = { ...map };
  for (const [from, to] of moved) {
    const local = before[String(from)];
    if (local === undefined) continue;
    delete map[String(from)];
    map[String(to)] = local;
  }
}

/**
 * One round of sync for this computer. The first one joins its learning to the account (lessons
 * kept once, words newest wins, the account's settings first); after that, the newest change to
 * each record wins. `write` applies changes to this computer's database. Returns whether it changed.
 */
export async function desktopRound(
  local: LocalSnapshot,
  st: DesktopState,
  remote: Remote,
  write: (changes: LocalChange[]) => Promise<Created[]>,
  now = Date.now(),
): Promise<boolean> {
  const view = accountView(local, st.ids);
  const before = prints(view);
  if (!st.synced) {
    st.sync = newSyncState();
    const account: Db = { settings: {}, lessons: [], terms: {}, activity: {}, nextId: 1, installed: [] };
    applyRows(account, st.sync, st.device, await remote.pull(null));
    const moved = newMergeIds();
    const merged = mergeGuest(account, view, moved);
    renumber(st.ids.lesson, moved.lessons);
    renumber(st.ids.playlist, moved.playlists);
    renumber(st.ids.chat, moved.chats);
    for (const k of Object.keys(view)) delete (view as unknown as Record<string, unknown>)[k];
    Object.assign(view, merged);
  }
  // this computer's own settings are neither sent nor read as deleted when the account has them
  await syncOnce(view, st.sync, st.device, remote, now, (key) => key.startsWith("setting:") && DEVICE_SETTING.test(key.slice(8)));
  st.synced = true;
  const { lessons, rest } = writes(before, view, st.ids);
  const created = lessons.length ? await write(lessons) : [];
  const others = rest(created);
  for (const c of others.length ? await write(others) : []) {
    const kind = others.find((o) => o.key === c.key)?.kind;
    if (kind === "playlist" || kind === "chat") st.ids[kind][c.key.slice(4)] = c.id;
  }
  // records gone from this computer and the account no longer need an id
  for (const kind of ["lesson", "playlist", "chat"] as const) {
    const present = new Set((kind === "lesson" ? view.lessons : kind === "playlist" ? (view.playlists ?? []) : (view.chats ?? [])).map((x) => String(x.id)));
    for (const id of Object.keys(st.ids[kind])) if (!present.has(id) && !st.sync.pending[`${kind}:${id}`]) delete st.ids[kind][id];
  }
  return lessons.length + others.length > 0;
}
