// Discover on the web: what a learner can do with an item without the desktop app,
// and which sources they follow.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Icon, type IconName } from "../../components/Icon";
import { Sheet, Switch } from "../../components/ui";
import { api, errorText } from "../../lib/api";
import { youtubeId } from "../../lib/covers";
import { ago, cleanTitle, openSource, useDiscover } from "../../lib/discover";
import { t } from "../../lib/i18n";
import { useImports } from "../../lib/imports";
import { fromItem, jobOf } from "../../lib/preview";
import { formatDuration, useApp } from "../../lib/store";
import type { DiscoverItem, LangCode } from "../../lib/types";
import { adoptPublished } from "../../lib/web/catalogue";
import { useAccount } from "../../lib/web/cloud";
import { PUBLISHED_SOURCE, listSources, type DiscoverSource } from "../../lib/web/discover";

/** Where the desktop app is downloaded. */
export const DESKTOP_APP_URL = "https://github.com/jaimielovett/wikang-tagalog/releases/latest";

const onPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (matchMedia("(pointer: coarse)").matches && innerWidth < 900);

/** The item shown in the web sheet (watch, listen or read, then what can be done with it). */
const useWebItem = create<{ item: DiscoverItem | null; show(it: DiscoverItem | null): void }>((set) => ({
  item: null,
  show: (item) => set({ item }),
}));

/** A published lesson is copied into the private library. */
async function adopt(it: DiscoverItem, lang: LangCode): Promise<number | null> {
  try {
    const id = await adoptPublished(api(), it.id);
    await useDiscover.getState().mark(lang, it.id, id);
    useApp.getState().bumpLibrary();
    return id;
  } catch (e) {
    useApp.getState().toast(errorText(e), "error");
    return null;
  }
}

/** An article from a source becomes a lesson through the import queue (the server reads the page). */
function makeArticle(it: DiscoverItem, lang: LangCode) {
  useImports.getState().enqueue(jobOf(fromItem(it), lang));
  useApp.getState().toast(t("L'article devient une leçon…", "Turning the article into a lesson…"), "light");
}

/**
 * Touching an item on the web: a lesson opens, a published lesson is added then opened,
 * anything else opens the sheet (its player, and what can be done with it).
 * `make`: "Make it a lesson" — straight to the library when the web can do it.
 */
export function openOnWeb(it: DiscoverItem, lang: LangCode, make = false) {
  const app = useApp.getState();
  if (it.lesson_id) return app.openLesson(it.lesson_id);
  if (it.source === PUBLISHED_SOURCE) {
    void adopt(it, lang).then((id) => {
      if (!id) return;
      if (make) app.toast(t("Ajoutée à la bibliothèque", "Added to your library"), "light");
      else app.openLesson(id);
    });
    return;
  }
  if (make && it.kind === "text" && useAccount.getState().session) return makeArticle(it, lang);
  useWebItem.getState().show(it);
}

/** The sheet of a source item: watch, listen or read, then make it a lesson where the web can. */
export function WebItemSheet() {
  const item = useWebItem((s) => s.item);
  const show = useWebItem((s) => s.show);
  const signedIn = useAccount((s) => !!s.session);
  const lang = useApp((s) => s.lang)();
  const go = useApp((s) => s.go);
  if (!item) return <Sheet open={false} onClose={() => {}} title="">{null}</Sheet>;
  const close = () => show(null);
  const yt = youtubeId(item.url);
  const media = item.kind !== "text";
  const phone = onPhone();
  const facts = [item.source_name, item.duration > 0 ? formatDuration(item.duration) : "", item.published ? ago(item.published) : ""].filter(Boolean);
  const site = yt ? t("Voir sur YouTube", "Watch on YouTube") : media ? t("Écouter sur le site", "Listen on the site") : t("Lire sur le site", "Read on the site");

  let action: React.ReactNode = null;
  if (!media && signedIn)
    action = (
      <button className="btn primary" onClick={() => (close(), makeArticle(item, lang))}>
        <Icon name="sparkle" size={15} /> {t("En faire une leçon", "Make it a lesson")}
      </button>
    );
  else if (!media)
    action = (
      <button className="btn primary" onClick={() => (close(), go("account"))}>
        {t("Se connecter", "Sign in")}
      </button>
    );
  else if (!phone)
    action = (
      <button className="btn primary" onClick={() => void openSource(DESKTOP_APP_URL)}>
        <Icon name="download" size={15} /> {t("Télécharger l'application", "Get the desktop app")}
      </button>
    );

  return (
    <Sheet
      open
      onClose={close}
      title={cleanTitle(item.title)}
      footer={
        <>
          <button className="btn ghost" onClick={() => void openSource(item.page || item.url)}>
            <Icon name="external" size={15} /> {site}
          </button>
          {action}
        </>
      }
    >
      <p className="web-item-facts num">{facts.join(" · ")}</p>
      {yt ? (
        <div className="web-item-player">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${yt}`}
            title={cleanTitle(item.title)}
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      ) : item.kind === "audio" ? (
        <audio className="web-item-audio" controls preload="none" src={item.url} />
      ) : item.image ? (
        <img className="web-item-image" src={item.image} alt="" />
      ) : null}
      {item.summary && <p className="web-item-summary" dir="auto">{item.summary}</p>}
      {media ? (
        <div className="web-item-note">
          <Icon name="laptop" size={18} />
          <span>
            <strong>{t("Une leçon, dans l'application de bureau", "A lesson, in the desktop app")}</strong>
            {phone
              ? t(
                  "Ouvrez Wikang Tagalog sur votre ordinateur : l'application de bureau transcrit les vidéos et les sons mot à mot, pour que la lanterne suive la voix.",
                  "Open Wikang Tagalog on your computer: the desktop app transcribes videos and audio word by word, so the lantern follows the voice.",
                )
              : t(
                  "L'application de bureau transcrit les vidéos et les sons mot à mot, pour que la lanterne suive la voix.",
                  "The desktop app transcribes videos and audio word by word, so the lantern follows the voice.",
                )}
          </span>
        </div>
      ) : (
        !signedIn && (
          <div className="web-item-note">
            <Icon name="user" size={18} />
            <span>
              <strong>{t("Connectez-vous pour en faire une leçon", "Sign in to make it a lesson")}</strong>
              {t("Wikang Tagalog lit l'article pour vous et le range dans votre bibliothèque.", "Wikang Tagalog reads the article for you and keeps it in your library.")}
            </span>
          </div>
        )
      )}
    </Sheet>
  );
}

const SHELVES: [DiscoverItem["shelf"], () => string][] = [
  ["learn", () => t("Pour apprendre", "For learners")],
  ["news", () => t("Actualités", "News")],
  ["culture", () => t("Culture et curiosités", "Culture and curiosity")],
  ["music", () => t("Chansons", "Songs")],
];
const kindOf: Record<string, [IconName, () => string]> = {
  lessons: ["sparkle", () => t("Leçons préparées, prêtes à lire", "Prepared lessons, ready to open")],
  youtube: ["youtube", () => t("Chaîne YouTube", "YouTube channel")],
  podcast: ["podcast", () => "Podcast"],
  articles: ["text", () => "Articles"],
};

type Row = Pick<DiscoverSource, "id" | "name" | "shelf" | "created_at"> & { kind: string };
const lessonsRow = (): Row => ({ id: PUBLISHED_SOURCE, name: t("Leçons Wikang Tagalog", "Wikang Tagalog lessons"), kind: "lessons", shelf: "learn", created_at: "" });

/** The sources a learner follows: all of them unless switched off. New ones are marked until seen. */
function useSources(open: boolean) {
  const [sources, setSources] = useState<Row[] | null>(null);
  useEffect(() => {
    let live = true;
    listSources()
      .then((all) => live && setSources([lessonsRow(), ...all.filter((s) => s.enabled && !s.retired_at)]))
      .catch(() => live && setSources([lessonsRow()]));
    return () => {
      live = false;
    };
  }, [open]);
  return sources;
}

/** The Discover band's "Sources" button, with a dot while a new source is unseen. */
export function SourcesButton() {
  const [open, setOpen] = useState(false);
  const sources = useSources(open);
  const seen = Number(useApp((s) => s.settings.sources_seen_at)) || 0;
  const fresh = !!seen && !!sources?.some((s) => s.created_at && Date.parse(s.created_at) / 1000 > seen);
  return (
    <>
      <button className="btn ghost sm" onClick={() => setOpen(true)}>
        <Icon name="layers" size={14} /> {t("Sources", "Sources")}
        {fresh && <span className="nav-discover-dot" aria-label={t("Nouvelle source", "New source")} />}
      </button>
      {/* the band clips and layers its children: the sheet lives at the page's top level */}
      {createPortal(<SourcesSheet open={open} sources={sources} seen={seen} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function SourcesSheet({ open, sources, seen, onClose }: { open: boolean; sources: Row[] | null; seen: number; onClose(): void }) {
  const settings = useApp((s) => s.settings);
  const setSetting = useApp((s) => s.setSetting);
  const lang = useApp((s) => s.lang)();
  const close = () => {
    void setSetting("sources_seen_at", String(Math.floor(Date.now() / 1000)));
    onClose();
  };
  const toggle = async (id: string, on: boolean) => {
    await setSetting(`source_off_${id}`, on ? "" : "1");
    void useDiscover.getState().load(lang);
  };
  return (
    <Sheet open={open} onClose={close} title={t("Vos sources", "Your sources")}>
      <p className="sources-lead">
        {t(
          "Découvrir puise dans ces sources, choisies pour apprendre le tagalog. Coupez celles qui ne vous parlent pas.",
          "Discover draws on these sources, chosen for learning Tagalog. Switch off the ones that aren't for you.",
        )}
      </p>
      {!sources ? (
        <p className="muted">{t("Chargement…", "Loading…")}</p>
      ) : (
        SHELVES.map(([shelf, label]) => {
          const rows = sources.filter((s) => s.shelf === shelf);
          if (!rows.length) return null;
          return (
            <section key={shelf} className="sources-group">
              <h4>{label()}</h4>
              {rows.map((s) => {
                const [icon, hint] = kindOf[s.kind] ?? kindOf.articles;
                const on = settings[`source_off_${s.id}`] !== "1";
                const fresh = !!seen && !!s.created_at && Date.parse(s.created_at) / 1000 > seen;
                return (
                  <div key={s.id} className={`source-row ${on ? "" : "off"}`}>
                    <Icon name={icon} size={17} />
                    <span className="source-meta">
                      <strong>
                        {s.name}
                        {fresh && <span className="source-new">{t("Nouveau", "New")}</span>}
                      </strong>
                      <span>{hint()}</span>
                    </span>
                    <Switch on={on} onChange={(v) => void toggle(s.id, v)} label={s.name} />
                  </div>
                );
              })}
            </section>
          );
        })
      )}
    </Sheet>
  );
}
