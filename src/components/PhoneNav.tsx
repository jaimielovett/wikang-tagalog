import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { useApp, type View } from "../lib/store";
import { useDiscoverNews } from "../lib/discover";
import { useAccount } from "../lib/web/cloud";
import { useUserName } from "../lib/user";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";

/** Views reached from "More": the tab stays lit while one of them is open. */
const MORE: View[] = ["playlists", "chat", "settings", "account", "reader"];

/**
 * On a phone, the navigation is a bar at the foot of the screen (styles: mobile.css).
 * Four places learners go every day, and the rest one tap away under "More".
 */
export function PhoneNav() {
  const view = useApp((s) => s.view);
  const go = useApp((s) => s.go);
  const lessonId = useApp((s) => s.lessonId);
  const openLesson = useApp((s) => s.openLesson);
  const openPlaylist = useApp((s) => s.openPlaylist);
  const openImport = useApp((s) => s.openImport);
  const lang = useApp((s) => s.lang)();
  const news = useDiscoverNews(lang);
  const signedIn = useAccount((s) => !!s.session);
  const email = useAccount((s) => s.session?.user.email);
  const name = useUserName();
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [view]);

  const tabs: { view: View; label: string; icon: IconName }[] = [
    { view: "library", label: t("Bibliothèque", "Library"), icon: "library" },
    { view: "discover", label: t("Découvrir", "Discover"), icon: "sparkle" },
    { view: "vocab", label: t("Mots", "Words"), icon: "cards" },
    { view: "progress", label: t("Progrès", "Progress"), icon: "chart" },
  ];
  const fresh = view !== "discover" && news.fresh > 0;
  const pick = (fn: () => void) => () => {
    setMore(false);
    fn();
  };
  const items: { key: string; label: string; icon: IconName | null; run(): void; hidden?: boolean }[] = [
    { key: "reader", label: t("Lecture en cours", "Now reading"), icon: "book", run: () => lessonId && openLesson(lessonId), hidden: !lessonId },
    { key: "import", label: t("Importer", "Import"), icon: "plus", run: () => openImport() },
    { key: "playlists", label: "Playlists", icon: "playlist", run: () => openPlaylist(null) },
    { key: "chat", label: "Chat", icon: "chat", run: () => go("chat") },
    { key: "settings", label: t("Réglages", "Settings"), icon: "settings", run: () => go("settings") },
    { key: "account", label: name || email || t("Se connecter", "Sign in"), icon: null, run: () => go("account") },
  ];

  return (
    <>
      <nav className="phone-nav" aria-label="Navigation">
        {tabs.map((tab) => (
          <button key={tab.view} className={`phone-tab ${view === tab.view ? "on" : ""}`} onClick={() => go(tab.view)} aria-current={view === tab.view ? "page" : undefined}>
            <span className="phone-tab-icon">
              <Icon name={tab.icon} size={22} />
              {tab.view === "discover" && fresh && <i className="phone-dot" aria-hidden="true" />}
            </span>
            <span>{tab.label}</span>
          </button>
        ))}
        <button className={`phone-tab ${more || MORE.includes(view) ? "on" : ""}`} onClick={() => setMore((m) => !m)} aria-expanded={more} aria-haspopup="menu">
          <span className="phone-tab-icon">{signedIn ? <Avatar size={22} /> : <Icon name="more" size={22} />}</span>
          <span>{t("Plus", "More")}</span>
        </button>
      </nav>
      <AnimatePresence>
        {more && (
          <>
            <motion.div className="phone-more-scrim" onClick={() => setMore(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div
              className="phone-more"
              role="menu"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
            >
              <span className="phone-more-grip" aria-hidden="true" />
              {items
                .filter((it) => !it.hidden)
                .map((it) => (
                  <button key={it.key} role="menuitem" className={`phone-more-item ${view === it.key ? "on" : ""}`} onClick={pick(it.run)}>
                    {it.icon ? <Icon name={it.icon} size={20} /> : <Avatar size={22} />}
                    <span>{it.label}</span>
                    <Icon name="forward" size={16} />
                  </button>
                ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
