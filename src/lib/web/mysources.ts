// Sources a learner adds to Discover themselves. Each is one setting (`my_source_<id>`), so the
// guest merge and sync keep them. Their items are read by the server on request and kept
// only on this device: they never enter the shared cache.
import { cloudRequest, useAccount } from "./cloud";
import { readSnapshot, writeSnapshot } from "./idb";
import type { DiscoverSource, SourceKind } from "./discover";
import type { DiscoverItem } from "../types";

export const MAX_OWN_SOURCES = 30;
const PREFIX = "my_source_";
/** An own source is read again once its items are this old. */
const STALE_MS = 3 * 3600_000;

export interface MySource {
  id: string;
  name: string;
  kind: SourceKind;
  url: string;
  shelf: DiscoverItem["shelf"];
  lo: number;
  hi: number;
  grade_titles: boolean;
  added_at: number;
}
/** What the server sends back for one source. */
interface ReadItem {
  id: string;
  kind: DiscoverItem["kind"];
  title: string;
  url: string;
  page: string;
  image: string;
  summary: string;
  duration: number;
  published: number;
  lo: number;
  hi: number;
}
interface Cached {
  read_at: number;
  items: ReadItem[];
  error?: string;
}
type Cache = Record<string, Cached>;

export const settingKey = (id: string) => PREFIX + id;

export function mySources(settings: Record<string, string>): MySource[] {
  return Object.entries(settings)
    .filter(([k, v]) => k.startsWith(PREFIX) && v)
    .flatMap(([, v]) => {
      try {
        return [JSON.parse(v) as MySource];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.added_at - b.added_at);
}

/** Same place on the web, whatever the scheme, "www." or trailing slash. */
export function sameSource(a: Pick<DiscoverSource, "kind" | "url">, b: Pick<DiscoverSource, "kind" | "url">) {
  if (a.kind === "youtube" || b.kind === "youtube") return a.kind === b.kind && a.url === b.url;
  const norm = (u: string) => {
    try {
      const x = new URL(u);
      return `${x.hostname.replace(/^www\./, "").toLowerCase()}${x.pathname.replace(/\/+$/, "")}${x.search}`;
    } catch {
      return u;
    }
  };
  return norm(a.url) === norm(b.url);
}

/** Levels and shelf a new source starts with: learner content for channels and podcasts, news for articles. */
export function newSource(found: { kind: SourceKind; url: string; name: string }): MySource {
  const id = `mine-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const articles = found.kind === "articles";
  return { id, name: found.name, kind: found.kind, url: found.url, shelf: articles ? "news" : "learn", lo: articles ? 3 : 2, hi: articles ? 5 : 4, grade_titles: !articles, added_at: Math.floor(Date.now() / 1000) };
}

export function findSource(url: string) {
  return cloudRequest<{ kind: SourceKind; url: string; name: string }>("discover-source", { action: "find", url });
}

const cacheKey = () => `wikang-tagalog:mine:${useAccount.getState().session?.user.id ?? "guest"}`;
export async function readCache(): Promise<Cache> {
  return (await readSnapshot<Cache>(cacheKey()).catch(() => undefined)) ?? {};
}

/** Reads sources on the server (ten per request) and keeps their items on this device. */
export async function readMine(sources: MySource[]): Promise<Cache> {
  const cache = await readCache();
  for (let i = 0; i < sources.length; i += 10) {
    const batch = sources.slice(i, i + 10);
    const { results } = await cloudRequest<{ results: { id: string; items: ReadItem[]; error?: string }[] }>("discover-source", {
      action: "read",
      sources: batch.map(({ id, kind, url, lo, hi, grade_titles }) => ({ id, kind, url, lo, hi, grade_titles })),
    });
    for (const r of results) cache[r.id] = { read_at: Date.now(), items: r.items, error: r.error };
  }
  await writeSnapshot(cacheKey(), cache);
  return cache;
}

export const isStaleMine = (cache: Cache, s: MySource) => !cache[s.id] || Date.now() - cache[s.id].read_at > STALE_MS;

/** An own source's cached items, shaped like the rest of Discover. */
export function mineItems(s: MySource, cache: Cache): (DiscoverItem & { source: string })[] {
  return (cache[s.id]?.items ?? []).map((it) => ({
    ...it,
    source: s.id,
    source_name: s.name,
    shelf: s.shelf,
    page_text: false,
    fetched_at: Math.floor((cache[s.id]?.read_at ?? 0) / 1000),
    lesson_id: null,
    artist: "",
    track: "",
  }));
}

/** What the Sources list says about an own source. */
export function mineStatus(s: MySource, cache: Cache): string {
  const c = cache[s.id];
  if (!c) return "Not read yet";
  if (c.error) return c.error;
  if (!c.items.length) return s.kind === "articles" ? "No Tagalog articles yet" : "Nothing new yet";
  return `${c.items.length} item${c.items.length === 1 ? "" : "s"}`;
}
