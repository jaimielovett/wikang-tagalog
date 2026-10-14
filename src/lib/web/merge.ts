// Bringing guest learning into a signed-in account: nothing done before signing in is lost.
import type { Db } from "./local";

/** Whether a guest has anything worth keeping (welcome finished, a lesson, a word). */
export function hasLearning(db: Db | undefined): db is Db {
  return !!db && (db.settings.onboarded === "1" || db.lessons.length > 0 || Object.keys(db.terms).length > 0);
}

const sameLesson = (a: Db["lessons"][number], b: Db["lessons"][number]) => a.lang === b.lang && a.title === b.title && a.text === b.text;

/**
 * Merges `guest` into `account` and returns the result; neither input is changed.
 * The account wins where both have a value, except that known words keep their
 * latest status and daily activity is added together.
 */
export function mergeGuest(account: Db, guest: Db): Db {
  const out: Db = structuredClone(account);
  const g = structuredClone(guest);
  out.playlists ??= [];
  out.chats ??= [];

  // lessons: the same lesson (the welcome story) is kept once, others get new ids
  const ids = new Map<number, number>();
  for (const lesson of g.lessons) {
    const twin = out.lessons.find((l) => sameLesson(l, lesson));
    if (twin) {
      ids.set(lesson.id, twin.id);
      continue;
    }
    const id = out.nextId++;
    ids.set(lesson.id, id);
    out.lessons.push({ ...lesson, id });
  }
  const lessonId = (id: number | null | undefined) => (id == null ? null : (ids.get(id) ?? null));

  // words: the most recent decision wins
  for (const [key, term] of Object.entries(g.terms)) {
    const mine = out.terms[key];
    if (!mine || (term.updated_at ?? 0) > (mine.updated_at ?? 0)) out.terms[key] = term;
  }

  // daily activity: time and words from both add up
  for (const [key, day] of Object.entries(g.activity)) {
    const mine = out.activity[key];
    out.activity[key] = mine
      ? {
          ...mine,
          words_read: mine.words_read + day.words_read,
          known_added: mine.known_added + day.known_added,
          lingqs: mine.lingqs + day.lingqs,
          listen_secs: mine.listen_secs + day.listen_secs,
          learn_secs: mine.learn_secs + day.learn_secs,
          goal_met: mine.goal_met || day.goal_met,
        }
      : day;
  }

  let playlistId = Math.max(0, ...out.playlists.map((p) => p.id));
  for (const p of g.playlists ?? []) {
    const lessons = p.lessons.map((id) => ids.get(id)).filter((id): id is number => id != null);
    out.playlists.push({ ...p, id: ++playlistId, lessons, current: lessonId(p.current) });
  }

  let chatId = Math.max(0, ...out.chats.map((c) => c.id));
  for (const c of g.chats ?? []) out.chats.push({ ...c, id: ++chatId, lesson_id: lessonId(c.lesson_id) });

  // settings: the account's choices stay; the guest fills in what is missing.
  // Keys that point at a lesson follow its new id.
  for (const [key, value] of Object.entries(g.settings)) {
    let k = key;
    let v = value;
    const published = /^published_(\d+)$/.exec(key);
    if (published) {
      const id = ids.get(Number(published[1]));
      if (id == null) continue;
      k = `published_${id}`;
    }
    if (/^catalogue_/.test(key) || key === "last_lesson") {
      const id = ids.get(Number(value));
      if (id == null) continue;
      v = String(id);
    }
    if (!(k in out.settings)) out.settings[k] = v;
  }
  if (g.settings.onboarded === "1") out.settings.onboarded = "1";

  out.installed = [...new Set([...out.installed, ...g.installed])];
  return out;
}
