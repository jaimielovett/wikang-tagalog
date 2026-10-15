// What the companion sends for a lesson made on this computer, without Tauri or the network:
// where it will play on the web (YouTube, the episode's address, or a private copy of its sound),
// and the record the account keeps.
import { remoteMedia } from "./remote-media.ts";

/** A lesson as the outbox holds it: the web's shape, with this computer's id and files. */
export interface OutboxLesson {
  id: number;
  lang: string;
  title: string;
  collection: string;
  kind: string;
  source: string;
  text: string;
  media_path: string | null;
  timings: string | null;
  video_path: string | null;
  hue: number;
  word_count: number;
  duration: number;
  timing_v: number;
  created_at: number;
  media_url?: string | null;
}

/** The largest recording the account keeps (the learner-media bucket's own limit). */
export const MAX_RECORDING = 150 * 1024 * 1024;

const TYPES: Record<string, string> = { m4a: "audio/mp4", mp4: "video/mp4", m4v: "video/mp4", aac: "audio/aac", mp3: "audio/mpeg", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/opus", wav: "audio/wav", flac: "audio/flac", webm: "audio/webm" };
const extOf = (path: string) => /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";

/** Where a lesson made here plays on the web: YouTube or the episode's address, else a private copy of its sound. */
export type Plan = { media_url: string | null; kind: string; upload: { from: string; ext: string; type: string } | null };

export function planFor(l: OutboxLesson): Plan {
  const remote = remoteMedia({ media_path: null, source: l.source, media_url: l.media_url });
  if (remote?.kind === "youtube") return { media_url: l.media_url || l.source, kind: "video", upload: null };
  if (remote?.kind === "audio") return { media_url: remote.url, kind: "audio", upload: null };
  if (l.media_path) {
    const ext = extOf(l.media_path);
    const type = TYPES[ext];
    if (!type) throw new Error(`This sound format (.${ext}) can't be kept online.`);
    return { media_url: null, kind: "audio", upload: { from: l.media_path, ext, type } };
  }
  return { media_url: null, kind: l.kind, upload: null };
}

/** The lesson as the account stores it (the web's record for `lesson:<id>`). */
export function accountLesson(l: OutboxLesson, id: number, media_url: string | null, kind: string) {
  return {
    id,
    lang: "tl",
    title: l.title,
    collection: l.collection,
    kind,
    source: l.source,
    text: l.text,
    media_path: null,
    timings: l.timings,
    video_path: null,
    hue: l.hue,
    word_count: l.word_count,
    page: 0,
    completed: false,
    position: 0,
    anchor: 0,
    duration: l.duration,
    cover_path: null,
    timing_v: l.timing_v,
    created_at: l.created_at,
    ...(media_url ? { media_url } : {}),
  };
}
