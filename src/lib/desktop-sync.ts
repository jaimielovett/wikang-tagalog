// The desktop app's sync with the learner's account, once signed in: its database read and written
// by src-tauri/src/sync.rs, in rounds run by desktop-syncmap.ts with the web's sync engine. A lesson
// made from a video here appears in the web library, and the web's learning appears here.
import { invoke } from "@tauri-apps/api/core";
import type { Api } from "./api";
import { desktopRound, newDesktopState, type Created, type DesktopState, type LocalChange, type LocalSnapshot } from "./desktop-syncmap.ts";
import { cloud, useAccount } from "./web/cloud";
import { readSnapshot, writeSnapshot } from "./web/idb";
import { REMOTE_CHANGE, remoteFor, syncFailed } from "./web/storage";
import { MAX_RECORDING, privateAddress, recordingToShare } from "./lesson-media";

/** Calls that change the learning: a round follows shortly after each. */
const WRITES = new Set([
  "settingsSet", "lessonCreate", "lessonUpdate", "lessonDelete", "lessonsDelete", "lessonSetCover", "playlistCreate", "playlistUpdate",
  "playlistDelete", "termSet", "termsMarkKnown", "activityAdd", "chatCreate", "chatUpdate", "chatDelete", "chatSend", "importMedia",
  "importLink", "importSong", "podcastCreate", "lessonVoice", "lessonResync", "lessonFetchVideo", "lingqImport", "backupRestore", "discoverMark",
]);

let state: DesktopState | null = null;
let key = "";
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let again = false;

const setSync = (sync: string) => useAccount.setState({ sync });

async function round(): Promise<void> {
  const user = useAccount.getState().session?.user;
  if (!cloud || !user || !state) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    // recordings only this computer has go to the learner's private storage first, so the
    // lesson reaches their other computers with its sound
    let local = await invoke<LocalSnapshot>("sync_export");
    if (await shareRecordings(user.id, local)) local = await invoke<LocalSnapshot>("sync_export");
    const changed = await desktopRound(local, state, remoteFor(user.id), (changes: LocalChange[]) => invoke<Created[]>("sync_apply", { changes }));
    await writeSnapshot(key, state);
    setSync("Synced");
    if (changed) window.dispatchEvent(new Event(REMOTE_CHANGE));
  } catch (e) {
    syncFailed(e);
    schedule(15_000);
  } finally {
    running = false;
    if (again) {
      again = false;
      schedule(500);
    }
  }
}

/** Recordings not sent this session, and when to try again (never, for one too large to keep). */
const unshared = new Map<number, number>();

/** Sends each recording only this computer has to the learner's private storage; returns whether any left. */
async function shareRecordings(userId: string, local: LocalSnapshot): Promise<boolean> {
  let shared = false;
  for (const l of local.lessons) {
    const kind = recordingToShare(l);
    if (!kind || (unshared.get(l.id) ?? 0) > Date.now() || !cloud) continue;
    try {
      const bytes = await invoke<ArrayBuffer>("read_file", { path: l.media_path });
      if (bytes.byteLength > MAX_RECORDING) {
        unshared.set(l.id, Infinity);
        continue;
      }
      const path = `${userId}/${crypto.randomUUID()}.${kind.ext}`;
      const { error } = await cloud.storage.from("learner-media").upload(path, new Blob([bytes], { type: kind.type }), { contentType: kind.type, upsert: false });
      if (error) throw error;
      await invoke("lesson_set_remote", { id: l.id, url: privateAddress(path) });
      shared = true;
    } catch {
      // offline or refused (storage full): tried again in a while
      unshared.set(l.id, Date.now() + 10 * 60_000);
    }
  }
  return shared;
}

/** A round soon: after a change, the next ones are folded into it. */
export function schedule(delay = 2500) {
  if (!state) return;
  clearTimeout(timer);
  timer = setTimeout(() => void round(), delay);
}

/** Starts syncing when signed in: now, a moment after each change, every minute, and on coming back into view. */
export async function startDesktopSync() {
  const user = useAccount.getState().session?.user;
  if (!cloud || !user || state) return;
  key = `wikang-tagalog:desktop-sync:${user.id}`;
  state = (await readSnapshot<DesktopState>(key).catch(() => undefined)) ?? newDesktopState(crypto.randomUUID().replace(/-/g, "").slice(0, 12));
  setSync(state.synced ? "Synced" : "Bringing your learning together…");
  const first = state.synced ? schedule(1000) : round();
  setInterval(() => {
    if (document.visibilityState === "visible") void round();
  }, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") schedule(300);
  });
  window.addEventListener("online", () => schedule(300));
  await first;
}

/** The desktop API, with a round scheduled after every call that changes the learning. */
export function syncAfterWrites(api: Api): Api {
  return new Proxy(api, {
    get(target, name, receiver) {
      const value = Reflect.get(target, name, receiver);
      if (typeof value !== "function" || typeof name !== "string" || !WRITES.has(name)) return value;
      return (...args: unknown[]) => {
        const out = value.apply(target, args);
        void Promise.resolve(out).then(
          () => schedule(),
          () => {},
        );
        return out;
      };
    },
  });
}
