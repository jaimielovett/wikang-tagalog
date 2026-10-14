// Browser learning data uses the same rules as the desktop SQLite backend.
import type { Api, TermUpdate } from "../api";
import { t } from "../i18n";
import { remoteMedia } from "../remote-media";
import { normalize, tokenize } from "../tokenize";
import type { ChatMessage, ChatSummary, DayStat, GoalReached, Lesson, LessonSummary, NewLesson, Playlist, Span, Stats, Term } from "../types";
export interface Db {
  settings: Record<string, string>;
  lessons: Lesson[];
  terms: Record<string, Term>; // clé : lang|term
  activity: Record<string, DayStat & { lang: string }>;
  nextId: number;
  installed: string[];
  playlists?: Playlist[];
  chats?: (Omit<ChatSummary, "lesson_title" | "count" | "preview"> & { messages: ChatMessage[] })[];
  backup?: { last_at: number | null; size: number };
}

/** Jour local (AAAA-MM-JJ), comme le natif. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => ymd(new Date());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const parseDay = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const emptyDay = (day: string): DayStat => ({ day, words_read: 0, known_added: 0, lingqs: 0, listen_secs: 0, learn_secs: 0, goal_met: false });
export function createLocalApi(db: Db, commit: () => Promise<void>) {
  const playlists = () => (db.playlists ??= []);
  /** Ids from the clock (microsecond scale): two devices of one account never hand out the same one. */
  const newId = () => {
    const id = Math.max(db.nextId, Date.now() * 1000 + Math.floor(Math.random() * 1000));
    db.nextId = id + 1;
    return id;
  };
  const chats = () => (db.chats ??= []);
  const chatSummary = (c: ReturnType<typeof chats>[number]): ChatSummary => {
    const last = c.messages[c.messages.length - 1];
    const { messages, ...rest } = c;
    return {
      ...rest,
      lesson_title: db.lessons.find((l) => l.id === c.lesson_id)?.title ?? null,
      count: messages.length,
      preview: last ? last.content.replace(/\*\*/g, "").replace(/\s+/g, " ").slice(0, 160) : "",
    };
  };
  /** mêmes règles que le natif : sans doublon, leçons de la langue de la playlist */
  const fill = (lang: string, ids: number[]) => [...new Set(ids)].filter((id) => db.lessons.some((l) => l.id === id && l.lang === lang));

  const bump = (lang: string, field: "words_read" | "known_added" | "lingqs" | "listen_secs" | "learn_secs", n: number) => {
    const k = `${today()}|${lang}`;
    const a = db.activity[k] ?? { ...emptyDay(today()), lang };
    (a[field] as number) = ((a[field] as number) ?? 0) + n;
    db.activity[k] = a;
  };

  /** objectif du jour en minutes (réglage `daily_goal`) */
  const goalMin = () => {
    const m = Number(db.settings.daily_goal);
    return m >= 1 && m <= 600 ? Math.round(m) : 10;
  };
  /** série en cours et record ; la série d'hier tient tant que la journée n'est pas finie */
  const streakOf = (rows: DayStat[], goal: number): Stats["streak"] => {
    const td = today();
    const met = new Set(rows.filter((d) => d.goal_met || (d.day === td && (d.learn_secs ?? 0) >= goal * 60)).map((d) => d.day));
    const done = met.has(td);
    let current = 0;
    for (let d = done ? new Date() : addDays(new Date(), -1); met.has(ymd(d)); d = addDays(d, -1)) current++;
    let best = 0;
    let run = 0;
    let prev = "";
    for (const d of [...met].sort()) {
      run = prev && ymd(addDays(parseDay(prev), 1)) === d ? run + 1 : 1;
      best = Math.max(best, run);
      prev = d;
    }
    return { current, best: Math.max(best, current), today_done: done, goal_min: goal, today_secs: rows.find((d) => d.day === td)?.learn_secs ?? 0 };
  };

  // miroir de new_share (db.rs)
  const newShare = (fresh: number, distinct: number) => {
    if (!distinct || !fresh) return 0;
    if (fresh === distinct) return 100;
    return Math.min(99, Math.max(1, Math.round((fresh * 100) / distinct)));
  };

  // fin du dernier mot minuté ([début, fin, t0, t1], …)
  const lastWordEnd = (timings: string | null): number => {
    try {
      const all = JSON.parse(timings ?? "[]") as number[][];
      return all.length ? all[all.length - 1][3] : 0;
    } catch {
      return 0;
    }
  };

  const summary = (l: Lesson): LessonSummary => {
    const keys = tokenize(l.text, l.lang).filter((t) => t.w).map((t) => t.k);
    const uniq = new Set<string>();
    for (const k of keys) if (!db.terms[`${l.lang}|${k}`]) uniq.add(k);
    const distinct = new Set(keys).size;
    const newPct = newShare(uniq.size, distinct);
    return {
      id: l.id,
      lang: l.lang,
      title: l.title,
      collection: l.collection,
      kind: l.kind,
      source: l.source,
      hue: l.hue,
      word_count: l.word_count,
      page: l.page,
      completed: l.completed,
      has_media: !!l.media_path || !!remoteMedia(l),
      created_at: (l as Lesson & { created_at?: number }).created_at ?? 0,
      opened_at: (l as Lesson & { opened_at?: number }).opened_at ?? null,
      new_words: uniq.size,
      new_pct: newPct,
      // même base que new_pct : les mots différents (comme lessons_list)
      known_pct: distinct ? 100 - newPct : 100,
      excerpt: l.text.slice(0, 220).replace(/\n/g, " "),
      position: l.position ?? 0,
      // comme lessons_list : durée lue dans le fichier, à défaut la fin du dernier mot minuté
      duration: l.duration || (l.media_path || remoteMedia(l) ? lastWordEnd(l.timings) : 0),
      cover_path: l.cover_path ?? null,
    };
  };

  const local: Pick<Api, "settingsGet" | "settingsSet" | "lessonsList" | "lessonOpen" | "lessonCreate" | "lessonUpdate" | "lessonDelete" | "lessonsDelete" | "playlistsList" | "playlistCreate" | "playlistUpdate" | "playlistDelete" | "lessonSetCover" | "termSet" | "termsMarkKnown" | "termsList" | "stats" | "activityAdd" | "chatsList" | "chatOpen" | "chatCreate" | "chatUpdate" | "chatDelete"> = {
    async settingsGet() {
      return { ...db.settings };
    },
    async settingsSet(key, value) {
      db.settings[key] = value;
      // nouvel objectif du jour : une journée déjà au-dessus est acquise
      if (key === "daily_goal") for (const a of Object.values(db.activity)) if (a.day === today() && (a.learn_secs ?? 0) >= goalMin() * 60) a.goal_met = true;
      await commit();
    },
    async lessonsList(lang) {
      return db.lessons
        .filter((l) => l.lang === lang)
        .map(summary)
        .sort((a, b) => (b.opened_at ?? b.created_at) - (a.opened_at ?? a.created_at));
    },
    async lessonOpen(id) {
      const l = db.lessons.find((x) => x.id === id);
      if (!l) throw t("Leçon introuvable", "Lesson not found");
      (l as Lesson & { opened_at?: number }).opened_at = Date.now() / 1000;
      await commit();
      const tokens = tokenize(l.text, l.lang);
      const terms: Record<string, Term> = {};
      for (const [k, t] of Object.entries(db.terms)) {
        const [lang, term] = k.split("|");
        if (lang === l.lang) terms[term] = t;
      }
      return { lesson: l, tokens, terms };
    },
    async lessonCreate(n: NewLesson) {
      const id = newId();
      const l: Lesson & { created_at: number } = {
        id,
        lang: "tl",
        title: n.title,
        collection: n.collection ?? "",
        kind: n.kind ?? "text",
        source: n.source ?? "",
        text: n.text,
        media_path: n.media_path ?? null,
        timings: n.timings ?? null,
        video_path: n.video_path ?? null,
        hue: Math.floor(Math.random() * 360),
        word_count: tokenize(n.text, "tl").filter((t) => t.w).length,
        page: 0,
        completed: false,
        position: 0,
        anchor: 0,
        duration: 0,
        cover_path: null,
        timing_v: 0,
        created_at: Date.now() / 1000,
      };
      db.lessons.push(l);
      await commit();
      return id;
    },
    async lessonUpdate(id, patch) {
      const l = db.lessons.find((x) => x.id === id);
      if (l) Object.assign(l, patch);
      await commit();
    },
    async lessonDelete(id) {
      await local.lessonsDelete([id]);
    },
    async lessonsDelete(ids) {
      const gone = new Set(ids);
      db.lessons = db.lessons.filter((l) => !gone.has(l.id));
      for (const c of chats()) if (c.lesson_id !== null && gone.has(c.lesson_id)) c.lesson_id = null;
      for (const p of playlists()) {
        p.lessons = p.lessons.filter((x) => !gone.has(x));
        if (p.current !== null && gone.has(p.current)) p.current = null;
      }
      await commit();
    },
    async playlistsList(lang) {
      return playlists()
        .filter((p) => p.lang === lang)
        .map((p) => ({ ...p, lessons: [...p.lessons], current: p.current && p.lessons.includes(p.current) ? p.current : null }))
        .sort((a, b) => b.created_at - a.created_at || b.id - a.id);
    },
    async playlistCreate(lang, name, lessons) {
      const id = newId();
      playlists().push({ id, lang, name: name.trim().replace(/\s+/g, " ").slice(0, 120) || t("Nouvelle playlist", "New playlist"), lessons: fill(lang, lessons), current: null, created_at: Date.now() / 1000 });
      await commit();
      return id;
    },
    async playlistUpdate(id, patch) {
      const p = playlists().find((x) => x.id === id);
      if (!p) return;
      if (patch.name !== undefined) p.name = patch.name.trim().replace(/\s+/g, " ").slice(0, 120) || t("Nouvelle playlist", "New playlist");
      if (patch.lessons) p.lessons = fill(p.lang, patch.lessons);
      if (patch.current !== undefined) p.current = patch.current > 0 ? patch.current : null;
      await commit();
    },
    async playlistDelete(id) {
      db.playlists = playlists().filter((p) => p.id !== id);
      await commit();
    },
    async lessonSetCover(id, data) {
      const l = db.lessons.find((x) => x.id === id);
      if (!l) throw t("Leçon introuvable", "Lesson not found");
      // dans le navigateur, l'image est gardée telle quelle (adresse data:)
      let url: string | null = null;
      if (data) {
        let bin = "";
        for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
        url = `data:image/jpeg;base64,${btoa(bin)}`;
      }
      l.cover_path = url;
      await commit();
      return url;
    },
    async termSet(u: TermUpdate) {
      const term = normalize(u.term, u.lang);
      const k = `${u.lang}|${term}`;
      const prev = db.terms[k];
      if (u.status === 0) {
        delete db.terms[k];
      } else {
        db.terms[k] = {
          term,
          status: u.status as Term["status"],
          translation: u.translation ?? prev?.translation ?? "",
          note: u.note ?? prev?.note ?? "",
          lemma: u.lemma ?? prev?.lemma ?? "",
          context: prev?.context || u.context || "",
          updated_at: Date.now() / 1000,
        };
        if (!prev && u.status <= 3) bump(u.lang, "lingqs", 1);
        if (prev?.status !== 4 && u.status === 4) bump(u.lang, "known_added", 1);
      }
      await commit();
    },
    async termsMarkKnown(lang, keys, wordsRead) {
      let added = 0;
      for (const raw of new Set(keys)) {
        const k = `${lang}|${normalize(raw, lang)}`;
        if (!db.terms[k]) {
          db.terms[k] = { term: normalize(raw, lang), status: 4, translation: "", note: "", lemma: "", context: "", updated_at: Date.now() / 1000 };
          added++;
        }
      }
      bump(lang, "known_added", added);
      bump(lang, "words_read", wordsRead);
      await commit();
      return added;
    },
    async termsList(q) {
      let items = Object.entries(db.terms)
        .filter(([k]) => k.startsWith(q.lang + "|"))
        .map(([, t]) => t);
      if (q.filter === "learning") items = items.filter((t) => t.status <= 3);
      if (q.filter === "known") items = items.filter((t) => t.status === 4);
      if (q.filter === "ignored") items = items.filter((t) => t.status === 5);
      if (q.filter === "phrases") items = items.filter((t) => t.term.includes(" "));
      if (q.filter === "all") items = items.filter((t) => t.status !== 5);
      if (q.search) {
        const s = normalize(q.search);
        items = items.filter((t) => t.term.includes(s) || t.translation.toLowerCase().includes(s));
      }
      items.sort((a, b) => (a.status <= 3 ? 0 : 1) - (b.status <= 3 ? 0 : 1) || b.updated_at - a.updated_at);
      return { items: items.slice(q.offset, q.offset + q.limit), total: items.length };
    },
    async stats(lang): Promise<Stats> {
      const terms = Object.entries(db.terms).filter(([k]) => k.startsWith(lang + "|")).map(([, t]) => t);
      const goal = goalMin();
      const now = new Date();
      const td = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const K = { td: ymd(td) } as Record<string, string>;
      const rows: DayStat[] = Object.values(db.activity)
        .filter((a) => a.lang === lang)
        .map(({ lang: _l, ...a }) => {
          const d = { ...emptyDay(a.day), ...a };
          if (d.day === K.td && d.learn_secs >= goal * 60) d.goal_met = true;
          return d;
        })
        .sort((a, b) => a.day.localeCompare(b.day));
      const active = (d: DayStat) => d.learn_secs > 0 || d.words_read > 0 || d.listen_secs > 0 || d.lingqs > 0 || d.known_added > 0;
      const span = (start: Date): Span => ({ start: ymd(start), words_read: 0, known_added: 0, lingqs: 0, listen_secs: 0, learn_secs: 0, active_days: 0, goal_days: 0 });
      const add = (s: Span, d: DayStat) => {
        s.words_read += d.words_read;
        s.known_added += d.known_added;
        s.lingqs += d.lingqs;
        s.listen_secs += d.listen_secs;
        s.learn_secs += d.learn_secs;
        s.active_days += active(d) ? 1 : 0;
        s.goal_days += d.goal_met ? 1 : 0;
      };
      // bornes des périodes (semaine depuis lundi, mois depuis le 1er)
      const yesterday = addDays(td, -1);
      const week = addDays(td, -((td.getDay() + 6) % 7));
      const lastWeek = addDays(week, -7);
      const month = new Date(td.getFullYear(), td.getMonth(), 1);
      const lastMonth = new Date(td.getFullYear(), td.getMonth() - 1, 1);
      const periods = { today: span(td), yesterday: span(yesterday), week: span(week), last_week: span(lastWeek), month: span(month), last_month: span(lastMonth), total: span(td) };
      const first = rows.find(active)?.day ?? null;
      if (first) periods.total.start = first;
      const weeksFrom = addDays(week, -77);
      const weeks = Array.from({ length: 12 }, (_, i) => span(addDays(weeksFrom, 7 * i)));
      const minFrom = new Date(month.getFullYear(), month.getMonth() - 11, 1);
      const maxFrom = new Date(month.getFullYear(), month.getMonth() - 35, 1);
      let monthsFrom = first ? new Date(parseDay(first).getFullYear(), parseDay(first).getMonth(), 1) : minFrom;
      if (monthsFrom > minFrom) monthsFrom = minFrom;
      if (monthsFrom < maxFrom) monthsFrom = maxFrom;
      const months: Span[] = [];
      for (let m = monthsFrom; m <= month; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) months.push(span(m));
      Object.assign(K, { y: ymd(yesterday), w: ymd(week), lw: ymd(lastWeek), m: ymd(month), lm: ymd(lastMonth), wf: ymd(weeksFrom), mf: ymd(monthsFrom) });
      const records = { words_read: 0, words_day: "", learn_secs: 0, learn_day: "" };
      for (const d of rows) {
        add(periods.total, d);
        if (d.day === K.td) add(periods.today, d);
        if (d.day === K.y) add(periods.yesterday, d);
        if (d.day >= K.w && d.day <= K.td) add(periods.week, d);
        if (d.day >= K.lw && d.day < K.w) add(periods.last_week, d);
        if (d.day >= K.m && d.day <= K.td) add(periods.month, d);
        if (d.day >= K.lm && d.day < K.m) add(periods.last_month, d);
        if (d.day >= K.wf && d.day <= K.td) {
          const w = weeks[Math.floor(Math.round((parseDay(d.day).getTime() - weeksFrom.getTime()) / 86400000) / 7)];
          if (w) add(w, d);
        }
        if (d.day >= K.mf && d.day <= K.td) {
          const dd = parseDay(d.day);
          const m = months[(dd.getFullYear() - monthsFrom.getFullYear()) * 12 + dd.getMonth() - monthsFrom.getMonth()];
          if (m) add(m, d);
        }
        if (d.words_read > records.words_read) Object.assign(records, { words_read: d.words_read, words_day: d.day });
        if (d.learn_secs > records.learn_secs) Object.assign(records, { learn_secs: d.learn_secs, learn_day: d.day });
      }
      const byDay = new Map(rows.map((r) => [r.day, r]));
      const days: DayStat[] = [];
      for (let d = addDays(week, -175); d <= td; d = addDays(d, 1)) days.push(byDay.get(ymd(d)) ?? emptyDay(ymd(d)));
      return {
        known: terms.filter((t) => t.status === 4 && !t.term.includes(" ")).length,
        learning: terms.filter((t) => t.status <= 3).length,
        phrases: terms.filter((t) => t.term.includes(" ")).length,
        lessons: db.lessons.filter((l) => l.lang === lang).length,
        days,
        weeks,
        months,
        periods,
        streak: streakOf(rows, goal),
        records,
        first_day: first,
      };
    },
    async activityAdd(lang, wordsRead, listenSecs, learnSecs = 0) {
      bump(lang, "words_read", Math.max(0, wordsRead));
      bump(lang, "listen_secs", Math.max(0, listenSecs));
      bump(lang, "learn_secs", Math.max(0, learnSecs));
      let reached: GoalReached | null = null;
      const a = db.activity[`${today()}|${lang}`];
      if (learnSecs > 0 && a && !a.goal_met && a.learn_secs >= goalMin() * 60) {
        a.goal_met = true;
        const rows = Object.values(db.activity).filter((x) => x.lang === lang);
        reached = { streak: streakOf(rows, goalMin()).current, goal_min: goalMin() };
      }
      await commit();
      return reached;
    },
    async chatsList(lang) {
      return chats()
        .filter((c) => c.lang === lang)
        .sort((a, b) => b.updated_at - a.updated_at || b.id - a.id)
        .map(chatSummary);
    },
    async chatOpen(id) {
      const c = chats().find((x) => x.id === id);
      if (!c) throw t("Cette conversation n'existe plus.", "This conversation no longer exists.");
      return { chat: chatSummary(c), messages: c.messages };
    },
    async chatCreate(lang, lesson) {
      const id = newId();
      const now = Date.now() / 1000;
      const lesson_id = lesson && db.lessons.some((l) => l.id === lesson && l.lang === lang) ? lesson : null;
      const c = { id, lang, title: "", lesson_id, created_at: now, updated_at: now, messages: [] };
      chats().push(c);
      await commit();
      return chatSummary(c);
    },
    async chatUpdate(id, patch) {
      const c = chats().find((x) => x.id === id);
      if (!c) throw t("Cette conversation n'existe plus.", "This conversation no longer exists.");
      if (patch.title !== undefined) c.title = patch.title.trim().replace(/\s+/g, " ").slice(0, 120);
      if (patch.lesson !== undefined) c.lesson_id = db.lessons.some((l) => l.id === patch.lesson && l.lang === c.lang) ? patch.lesson : null;
      await commit();
      return chatSummary(c);
    },
    async chatDelete(id) {
      db.chats = chats().filter((c) => c.id !== id);
      await commit();
    },
  };
  return local;
}
