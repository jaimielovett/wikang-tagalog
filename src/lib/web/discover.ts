// Discover on the web: admin-chosen sources, read by the server into a shared cache.
import { apiBase, cloud } from "./cloud";
import type { DiscoverItem } from "../types";

/** The published lessons count as one more source, on by default. */
export const PUBLISHED_SOURCE = "wikang-tagalog";
/** A visit to Discover asks for a refresh once the cache is this old. */
const STALE_SECS = 3 * 3600;

export type SourceKind = "youtube" | "podcast" | "articles";
export interface DiscoverSource {
  id: string;
  name: string;
  kind: SourceKind;
  url: string;
  shelf: DiscoverItem["shelf"];
  lo: number;
  hi: number;
  grade_titles: boolean;
  enabled: boolean;
  created_at: string;
  retired_at: string | null;
  last_fetched_at: string | null;
  last_error: string | null;
  item_count: number;
}
interface ItemRow {
  id: string;
  source_id: string;
  kind: DiscoverItem["kind"];
  title: string;
  url: string;
  page: string;
  image: string;
  summary: string;
  duration: number;
  published_at: string | null;
  lo: number;
  hi: number;
  fetched_at: string;
}

const seconds = (iso: string | null | undefined) => (iso ? Math.floor(Date.parse(iso) / 1000) : 0);

/** Sources everyone sees (admins also get retired ones). */
export async function listSources(): Promise<DiscoverSource[]> {
  if (!cloud) return [];
  const { data, error } = await cloud.from("discover_sources").select("*").order("shelf").order("name");
  if (error) throw new Error("Could not load the Discover sources. Please retry.");
  return data as DiscoverSource[];
}

/** Cached items of the enabled sources, newest first. */
export async function listItems(): Promise<{ items: (DiscoverItem & { source: string })[]; refreshedAt: number; refreshing: boolean }> {
  if (!cloud) return { items: [], refreshedAt: 0, refreshing: false };
  const [items, sources, status] = await Promise.all([
    cloud.from("discover_items").select("*").order("published_at", { ascending: false, nullsFirst: false }).limit(400),
    cloud.from("discover_sources").select("id,name,shelf"),
    cloud.rpc("discover_status"),
  ]);
  if (items.error || sources.error) throw new Error("Could not load Discover. Please retry.");
  const byId = new Map((sources.data as Pick<DiscoverSource, "id" | "name" | "shelf">[]).map((s) => [s.id, s]));
  const state = (status.data ?? {}) as { last_refresh_at?: string | null; refreshing?: boolean };
  return {
    refreshedAt: seconds(state.last_refresh_at),
    refreshing: !!state.refreshing,
    items: (items.data as ItemRow[]).flatMap((row) => {
      const source = byId.get(row.source_id);
      if (!source) return [];
      return [
        {
          id: row.id,
          source: row.source_id,
          source_name: source.name,
          shelf: source.shelf,
          kind: row.kind,
          title: row.title,
          url: row.url,
          page: row.page,
          image: row.image,
          summary: row.summary,
          duration: row.duration,
          published: seconds(row.published_at),
          lo: row.lo,
          hi: row.hi,
          page_text: false,
          fetched_at: seconds(row.fetched_at),
          lesson_id: null,
          artist: "",
          track: "",
        },
      ];
    }),
  };
}

export const isStale = (refreshedAt: number) => Date.now() / 1000 - refreshedAt > STALE_SECS;

/** Asks the server to read the sources. Admins (signed in) skip the "refreshed recently" window. */
export async function requestRefresh(): Promise<{ refreshed: boolean; sources: number; failed: string[] }> {
  const session = cloud ? (await cloud.auth.getSession()).data.session : null;
  const response = await fetch(`${apiBase}/api/discover-refresh`, {
    method: "POST",
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Discover could not be refreshed. Please retry.");
  return body;
}

/** YouTube channel ID from what an admin pastes: the ID itself, or a youtube.com/channel/… link. */
export function channelId(value: string): string | null {
  const v = value.trim();
  if (/^UC[\w-]{22}$/.test(v)) return v;
  const m = /youtube\.com\/channel\/(UC[\w-]{22})/.exec(v);
  return m ? m[1] : null;
}
