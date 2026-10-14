import { AnimatePresence, motion } from "motion/react";
import { DESKTOP_APP_URL, useUpdate } from "../lib/updater";
import { Icon } from "./Icon";
import { t, uiLang } from "../lib/i18n";
import { openSource } from "../lib/discover";

/** Titres des nouveautés annoncées par la mise à jour (notes du manifeste : { fr: [...], en: [...] }). */
function noteTitles(notes: string): string[] {
  try {
    const list = JSON.parse(notes)?.[uiLang()];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Carte discrète en bas de la barre latérale quand une mise à jour existe. */
export function UpdateCard() {
  const { phase, version, notes, progress, dismissed, required, install, restart, dismiss, error } = useUpdate();
  // too old to sync: the card stays until the app is updated
  const visible = required || (!dismissed && ["available", "downloading", "ready"].includes(phase));
  const titles = noteTitles(notes);
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="update-card"
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
        >
          <div className="update-head">
            <span className="update-dot" />
            <strong>
              {phase === "ready"
                ? t("Mise à jour installée", "Update installed")
                : required
                  ? t("Mise à jour nécessaire", "Update required")
                  : t(`Wikang Tagalog ${version} est disponible`, `Wikang Tagalog ${version} is available`)}
            </strong>
            {phase === "available" && !required && (
              <button className="icon-btn" style={{ width: 24, height: 24, marginLeft: "auto" }} onClick={dismiss} aria-label={t("Plus tard", "Later")}>
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
          {required && phase !== "ready" && (
            <span className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              {t("Cette version ne peut plus synchroniser votre compte. Mettez Wikang Tagalog à jour pour continuer.", "This version can no longer sync your account. Update Wikang Tagalog to continue.")}
            </span>
          )}
          {required && !["available", "downloading", "ready"].includes(phase) && (
            <button className="btn sm primary glow" onClick={() => void openSource(DESKTOP_APP_URL)}>
              <Icon name="download" size={14} /> {t("Télécharger la dernière version", "Download the latest version")}
            </button>
          )}
          {phase === "available" && titles.length > 0 && (
            <ul className="update-notes">
              {titles.slice(0, 3).map((x) => (
                <li key={x}>{x}</li>
              ))}
              {titles.length > 3 && <li className="more">{t(`et ${titles.length - 3} de plus`, `and ${titles.length - 3} more`)}</li>}
            </ul>
          )}
          {phase === "available" && (
            <button className="btn sm primary glow" onClick={install}>
              <Icon name="download" size={14} /> {t("Mettre à jour", "Update")}
            </button>
          )}
          {phase === "downloading" && (
            <div className="bar live">
              <i style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          {phase === "ready" && (
            <button className="btn sm primary glow" onClick={restart}>
              {t("Redémarrer Wikang Tagalog", "Restart Wikang Tagalog")}
            </button>
          )}
          {error && phase !== "available" && <span className="muted" style={{ fontSize: 11.5 }}>{error}</span>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
