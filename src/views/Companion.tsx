import { useEffect, useState } from "react";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { UpdateCard } from "../components/UpdateCard";
import { Orb } from "../components/ui";
import { errorText } from "../lib/api";
import { startOutbox } from "../lib/companion";
import { openSource } from "../lib/discover";
import { t } from "../lib/i18n";
import { apiBase, cloud, initAccount, useAccount } from "../lib/web/cloud";
import { ImportSheet } from "./ImportSheet";

/** The website, where the library lives and accounts are made. */
const SITE = apiBase || "https://www.wikangtagalog.com";

/**
 * The desktop companion: sign in, then import. Videos, podcasts and recordings are transcribed on
 * this computer and land in the learner's library on the website (lib/companion.ts); reading,
 * words and progress all happen there. No accounts are made here, and there is no welcome.
 */
export function Companion() {
  const signedIn = useAccount((s) => !!s.session);
  return signedIn ? <Importing /> : <SignIn />;
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    if (!cloud) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await cloud.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await initAccount();
      location.reload();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <div className="companion companion-signin">
      <div className="titlebar drag" data-tauri-drag-region />
      <main className="companion-signin-body">
        <Orb size={44} />
        <h1>Wikang Tagalog</h1>
        <p className="companion-lead">
          {t(
            "Le compagnon de bureau : transformez vidéos, podcasts et enregistrements en leçons, transcrites mot à mot. Elles rejoignent votre bibliothèque sur le site.",
            "The desktop companion: turn videos, podcasts and recordings into lessons, transcribed word by word. They join your library on the website.",
          )}
        </p>
        {!cloud ? (
          <p className="auth-note">{t("Les comptes ne sont pas encore connectés.", "Accounts aren't connected yet.")}</p>
        ) : (
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              void signIn();
            }}
          >
            <div className="field">
              <label htmlFor="c-email">Email</label>
              <input id="c-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com" autoFocus />
            </div>
            <div className="field">
              <label htmlFor="c-password">{t("Mot de passe", "Password")}</label>
              <input id="c-password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </div>
            {error && (
              <div className="auth-error" role="alert">
                <Icon name="ban" size={15} />
                <span>{error}</span>
              </div>
            )}
            <button className="btn primary glow lg auth-submit" disabled={busy}>
              {busy ? t("Un instant…", "One moment…") : t("Se connecter", "Sign in")}
            </button>
          </form>
        )}
        <p className="companion-links">
          {t("Pas encore de compte ?", "No account yet?")}{" "}
          <button className="link-btn" onClick={() => void openSource(SITE)}>
            {t("Créez-le sur wikangtagalog.com", "Create one on wikangtagalog.com")}
          </button>
        </p>
      </main>
    </div>
  );
}

function Importing() {
  const email = useAccount((s) => s.session?.user.email ?? "");
  useEffect(() => {
    void startOutbox().catch(() => {});
  }, []);
  return (
    <div className="companion">
      <header className="titlebar drag companion-bar" data-tauri-drag-region>
        <span className="companion-brand" data-tauri-drag-region>
          <Orb size={18} /> Wikang Tagalog
        </span>
        <span className="companion-grow" data-tauri-drag-region />
        <button className="btn sm soft no-drag" onClick={() => void openSource(SITE)}>
          <Icon name="library" size={15} /> {t("Ouvrir ma bibliothèque", "Open my library")}
        </button>
        <span className="companion-me no-drag" title={email}>
          <Avatar size={22} />
          <span>{email}</span>
        </span>
        <button
          className="btn sm ghost no-drag"
          onClick={async () => {
            await cloud?.auth.signOut();
            location.reload();
          }}
        >
          {t("Se déconnecter", "Sign out")}
        </button>
      </header>
      <main className="companion-body">
        <UpdateCard />
        <h1>{t("Importer", "Import")}</h1>
        <p className="companion-lead">
          {t(
            "Collez un lien YouTube ou de podcast, ou choisissez un fichier audio ou vidéo. La leçon est transcrite ici, puis rejoint votre bibliothèque sur wikangtagalog.com.",
            "Paste a YouTube or podcast link, or choose an audio or video file. The lesson is transcribed here, then joins your library on wikangtagalog.com.",
          )}
        </p>
        <ImportSheet embedded />
      </main>
    </div>
  );
}
