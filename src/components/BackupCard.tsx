import { AnimatePresence, motion } from "motion/react";
import { t } from "../lib/i18n";
import { useApp } from "../lib/store";
import { cloud, useAccount } from "../lib/web/cloud";
import { Icon } from "./Icon";

/** A week's quiet after "Later". */
const SNOOZE = 7 * 86400;

/**
 * The sidebar's warning for guests: their lessons, words and progress live on this computer only,
 * with no copy anywhere. An account keeps them safe and on all their computers (lib/desktop-sync.ts).
 */
export function BackupCard() {
  const signedIn = useAccount((s) => !!s.session);
  const snooze = useApp((s) => Number(s.settings.guest_snooze) || 0);
  const setSetting = useApp((s) => s.setSetting);
  const go = useApp((s) => s.go);
  const onAccount = useApp((s) => s.view === "account");
  const show = !!cloud && !signedIn && !onAccount && Date.now() / 1000 - snooze > SNOOZE;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="guest"
          className="update-card"
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
        >
          <div className="update-head">
            <span className="update-dot warn" />
            <strong>{t("Rien n'est sauvegardé", "Nothing is backed up")}</strong>
            <button
              className="icon-btn"
              style={{ width: 24, height: 24, marginLeft: "auto" }}
              onClick={() => void setSetting("guest_snooze", String(Math.floor(Date.now() / 1000)))}
              aria-label={t("Plus tard", "Later")}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
          <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.45 }}>
            {t(
              "Sans compte, vos leçons, vos mots et vos progrès ne sont que sur cet ordinateur : s'il est perdu ou effacé, ils le sont aussi. Un compte gratuit les garde à l'abri, sur tous vos ordinateurs.",
              "Without an account, your lessons, words and progress are only on this computer: if it's lost or wiped, so are they. A free account keeps them safe, on all your computers.",
            )}
          </span>
          <button
            className="btn sm primary glow"
            onClick={() => {
              // the account page opens on "Create an account"
              sessionStorage.setItem("account_mode", "signup");
              go("account");
            }}
          >
            <Icon name="cloud" size={14} /> {t("Créer un compte", "Create an account")}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
