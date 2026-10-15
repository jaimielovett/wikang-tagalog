// A lesson's sound on each of the learner's computers, without Tauri or the network. A lesson
// made from YouTube or a podcast is fetched again from its source; a recording from a file on
// the computer is kept in the learner's private storage, and their other computers fetch it there.
import { PRIVATE_MEDIA, remoteMedia } from "./remote-media.ts";

export interface LessonSound {
  media_path: string | null;
  media_url?: string | null;
  source: string;
  timings?: string | null;
}

/** The largest recording the learner's storage keeps (the learner-media bucket's own limit). */
export const MAX_RECORDING = 150 * 1024 * 1024;

const TYPES: Record<string, string> = { m4a: "audio/mp4", mp4: "video/mp4", m4v: "video/mp4", aac: "audio/aac", mp3: "audio/mpeg", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/opus", wav: "audio/wav", flac: "audio/flac", webm: "audio/webm" };
const web = (s: string | null | undefined) => !!s && /^https?:/i.test(s);
export const extOf = (path: string) => /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";

/** A recording only this computer has: its sound goes to the learner's private storage (its type, or null). */
export function recordingToShare(l: LessonSound): { ext: string; type: string } | null {
  if (!l.media_path || web(l.media_path) || l.media_url || web(l.source)) return null;
  const ext = extOf(l.media_path);
  return TYPES[ext] ? { ext, type: TYPES[ext] } : null;
}

/** The address a shared recording is kept at, for the lesson (\`learner-media:<user>/<file>\`). */
export const privateAddress = (path: string) => `${PRIVATE_MEDIA}${path}`;

/** Where a lesson made on another computer gets its sound here: a file's address (`direct`), a page the downloader reads, or the learner's private storage. */
export type SoundFrom = { url: string; direct: boolean } | { private: string } | null;

export function soundFrom(l: LessonSound): SoundFrom {
  if (l.media_path || !l.timings) return null;
  const m = remoteMedia({ media_path: null, source: l.source, media_url: l.media_url });
  if (m?.kind === "private") return { private: m.path };
  if (m?.kind === "audio") return { url: m.url, direct: true };
  if (m?.kind === "youtube") return { url: l.media_url || l.source, direct: false };
  // another video or podcast page: the downloader knows a thousand sites
  if (web(l.media_url)) return { url: l.media_url!, direct: false };
  if (web(l.source)) return { url: l.source, direct: false };
  return null;
}
