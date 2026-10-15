// Discover from the shared catalogue: the published lessons, the
// admins' sources read by the server, and the learner's own sources. Settings say what is off, hidden
// and already a lesson, so they follow the learner between devices.
import type { Api } from '../api';
import { cloud, useAccount } from './cloud';
import { listPublished, mediaUrl, toDiscover } from './catalogue';
import { PUBLISHED_SOURCE, isStale, listItems, requestRefresh } from './discover';
import { isStaleMine, mineItems, mySources, readCache, readMine } from './mysources';

type SharedDiscover = Pick<Api, 'discoverList' | 'discoverRefresh' | 'discoverMark' | 'discoverHide' | 'discoverListen'>;

export function sharedDiscover(settings: () => Promise<Record<string, string>>, setSetting: (key: string, value: string) => Promise<void>): SharedDiscover {
  const listeners = new Set<(lang: string) => void>();
  const changed = () => listeners.forEach((f) => f('tl'));
  let refreshAsked = 0;
  let mineAsked = 0;
  return {
    async discoverList() {
      const [rows, feed, s] = await Promise.all([listPublished(), listItems(), settings()]);
      const off = (id: string) => s[`source_off_${id}`] === '1';
      const lessonOf = (id: string) => Number(s[`catalogue_${id}`]) || null;
      // the first visit sets the baseline for sources marked "New"
      if (!s.sources_seen_at) void setSetting('sources_seen_at', String(Math.floor(Date.now() / 1000)));
      const shown = rows.filter((r) => !s[`hidden_${r.id}`]);
      const covers = await Promise.all(shown.map((r) => mediaUrl(r.cover_path).catch(() => null)));
      // published lessons stay searchable when their source is off ("muted"), and replace the same video from a source
      const published = shown.map((r, i) => ({ ...toDiscover(r, lessonOf(r.id)), source: PUBLISHED_SOURCE, image: covers[i] ?? '', muted: off(PUBLISHED_SOURCE) }));
      const prepared = new Set(rows.map((r) => r.source_url).filter(Boolean));
      const found = feed.items.filter((it) => !off(it.source) && !s[`hidden_${it.id}`] && !prepared.has(it.url)).map((it) => ({ ...it, lesson_id: lessonOf(it.id) }));
      // the learner's own sources: items kept on this device, read again once stale (each request uses the daily budget)
      const mine = mySources(s).filter((x) => !off(x.id));
      const cache = mine.length ? await readCache() : {};
      const seenUrls = new Set(found.map((it) => it.url));
      const own = mine.flatMap((x) => mineItems(x, cache)).filter((it) => !s[`hidden_${it.id}`] && !prepared.has(it.url) && !seenUrls.has(it.url)).map((it) => ({ ...it, lesson_id: lessonOf(it.id) }));
      const stale = mine.filter((x) => isStaleMine(cache, x));
      if (useAccount.getState().session && stale.length && Date.now() - mineAsked > 10 * 60_000) {
        mineAsked = Date.now();
        void readMine(stale).then(changed).catch(() => {});
      }
      // a stale cache refreshes itself; the view reloads when the server is done
      let refreshing = feed.refreshing;
      if (cloud && !refreshing && isStale(feed.refreshedAt) && Date.now() - refreshAsked > 10 * 60_000) {
        refreshAsked = Date.now();
        refreshing = true;
        // done or failed, the view reloads: it never waits on a refresh that is not coming
        void requestRefresh().catch(() => {}).finally(changed);
      }
      return { items: [...published, ...found, ...own], refreshed_at: feed.refreshedAt, refreshing, sources: new Set(feed.items.map((it) => it.source)).size + 1 + mine.length };
    },
    async discoverRefresh() {
      // the shared cache (at most every few hours) and, when signed in, the learner's own sources
      const s = await settings();
      const mine = useAccount.getState().session ? mySources(s).filter((x) => s[`source_off_${x.id}`] !== '1') : [];
      const [r, own] = await Promise.all([requestRefresh(), mine.length ? readMine(mine).then(() => true, () => false) : false]);
      return { added: 0, sources: r.sources + mine.length, failed: r.failed, skipped: !r.refreshed && !own };
    },
    async discoverMark(id, lesson) {
      await setSetting(`catalogue_${id}`, String(lesson));
    },
    async discoverHide(id) {
      await setSetting(`hidden_${id}`, '1');
    },
    async discoverListen(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
}
