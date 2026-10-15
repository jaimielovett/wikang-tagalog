import { useState } from "react";
import { DesktopDownload } from "../components/DesktopDownload";
import { Icon, type IconName } from "../components/Icon";

const REPO = "https://github.com/jaimielovett/wikang-tagalog";

/** Arriving from a sign-up confirmation email (Supabase adds `type=signup` to the address it links to). */
function confirmedEmail(): boolean {
  const params = new URLSearchParams(location.hash.replace(/^#/, "") || location.search);
  const confirmed = params.get("type") === "signup" || params.get("type") === "email_change";
  // the address carries the sign-in tokens: they are of no use here, so they leave the address bar
  if (params.has("access_token") || params.has("type")) history.replaceState(null, "", location.pathname);
  return confirmed;
}

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: "book", title: "Read and listen to what you love", body: "Books, articles, YouTube videos, podcasts and songs become lessons. Long books stay whole; their pages turn in the reader." },
  { icon: "sparkle", title: "Every word lights up", body: "Tap any word for its meaning in that sentence. New words glow blue, words you're learning amber, and known words fade into the page." },
  { icon: "cpu", title: "AI on your own computer", body: "Translation, transcription and chat run locally, so your learning stays private. Prefer an online model? Bring your own API key." },
  { icon: "cloud", title: "On all your computers", body: "Learn as a guest, or create a free account to keep your lessons, words and progress in step between your Windows and Mac computers." },
];

/** wikangtagalog.com: Wikang Tagalog is a desktop app; the website is where you download it. */
export function Landing() {
  const [confirmed] = useState(confirmedEmail);
  return (
    <div className="landing">
      <main className="landing-main">
        {confirmed && (
          <div className="landing-note" role="status">
            <Icon name="check" size={16} stroke={2} /> Your email is confirmed. Open Wikang Tagalog on your computer and sign in.
          </div>
        )}
        <section className="landing-hero">
          <span className="orb" style={{ width: 64, height: 64, ["--s" as string]: "64px" }} aria-hidden="true" />
          <h1>Wikang Tagalog</h1>
          <p className="landing-lead">Learn Tagalog the way you learned your own language: by reading and listening to what you love. One word at a time, until everything lights up.</p>
          <div className="landing-get">
            <DesktopDownload />
          </div>
          <p className="landing-small">Free for Windows and Macs with Apple silicon.</p>
        </section>
        <section className="landing-features" aria-label="What it does">
          {FEATURES.map((f) => (
            <article key={f.title} className="landing-feature">
              <span className="landing-icon">
                <Icon name={f.icon} size={20} />
              </span>
              <h2>{f.title}</h2>
              <p>{f.body}</p>
            </article>
          ))}
        </section>
      </main>
      <footer className="landing-foot">
        <span>
          Based on{" "}
          <a href="https://github.com/LivingTwice/lumen" target="_blank" rel="noopener">
            Lumen
          </a>{" "}
          by Ulysse Rives · Free software under the{" "}
          <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noopener">
            GPL
          </a>{" "}
          · Dictionary from{" "}
          <a href="https://kaikki.org/dictionary/Tagalog/" target="_blank" rel="noopener">
            Wiktionary
          </a>{" "}
          (CC BY-SA)
        </span>
        <a href={REPO} target="_blank" rel="noopener">
          Source code
        </a>
      </footer>
    </div>
  );
}
