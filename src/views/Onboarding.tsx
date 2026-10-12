import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarArt } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { Orb, Switch } from "../components/ui";
import { api, errorText, isTauri } from "../lib/api";
import { formatWhen, isCloud, pickBackupFolder, placeDir, reloadProgress, restoreStage, useBackup } from "../lib/backup";
import { count, t } from "../lib/i18n";
import { STARTERS, langLower, starterCollection } from "../lib/langs";
import { inFolder } from "../lib/platform";
import { PROFILES } from "../lib/profiles";
import { formatBytes, formatNumber, useApp } from "../lib/store";
import type { BackupInfo, BackupRestored, LangCode } from "../lib/types";
import { HUES, NAME_MAX, avatarString, avatarStyles, choosePhoto, newSeed, userFrom, type AvatarStyle } from "../lib/user";
import { useDraft } from "./ProfileSection";
import { Account } from "./Account";

const EASE = [0.16, 1, 0.3, 1] as const;
// marge au-dessus de la scène pour que les rayons de l'astre ne soient pas coupés
const CLIP_PAD = 200;

const stepAnim = {
  initial: { opacity: 0, y: 16, filter: "blur(10px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -10, filter: "blur(10px)" },
  transition: { duration: 0.6, ease: EASE },
};

function glow(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
  el.style.setProperty("--my", `${e.clientY - r.top}px`);
}

export function Onboarding() {
  const setSetting = useApp((s) => s.setSetting);
  // la langue de l'interface peut changer à tout moment de l'accueil
  const ui = useApp((s) => s.settings.ui_lang);
  const download = useApp((s) => s.download);
  const models = useApp((s) => s.models);
  const refreshKnown = useApp((s) => s.refreshKnown);
  const openLesson = useApp((s) => s.openLesson);
  const replay = useApp((s) => s.replay);
  const setReplay = useApp((s) => s.setReplay);
  const [n, setN] = useState(0);
  // en relecture, les langues déjà choisies restent cochées
  const langs: LangCode[] = ["tl"];
  const [goal, setGoal] = useState(() => Number(useApp.getState().settings.daily_goal) || 10);
  const [finishError, setFinishError] = useState("");
  const [profile, setProfile] = useState("balanced");
  // « Qu'est-ce qu'un modèle ? » déplié à l'étape de l'IA
  const [what, setWhat] = useState(false);
  const [bloom, setBloom] = useState<{ x: number; y: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const [H, setH] = useState(800);
  // sauvegarde : retrouver une progression (étape 4), ou sauvegarder la nouvelle
  const backup = useBackup((s) => s.status);
  const restoring = useBackup((s) => s.restoring);
  const restoreError = useBackup((s) => s.restoreError);
  const [found, setFound] = useState<BackupInfo[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [restored, setRestored] = useState<BackupRestored | null>(null);
  // le profil de la sauvegarde restaurée (« Bon retour, Léa »)
  const [restoredUser, setRestoredUser] = useState<ReturnType<typeof userFrom> | null>(null);
  // profil : le nom se tape ici, l'avatar suit aussitôt
  const [meName, setMeName, saveMeName] = useDraft("user_name", NAME_MAX);
  const meAvatar = useApp((s) => s.settings.user_avatar ?? "");
  const mePhoto = useApp((s) => s.settings.user_photo ?? "");
  const me = userFrom(meName, meAvatar, mePhoto);
  const firstName = useApp((s) => (s.settings.user_name ?? "").trim());
  const [saveCloud, setSaveCloud] = useState(true);
  // nuages du Mac : sans iCloud Drive, la sauvegarde va dans le premier autre (Dropbox, Google Drive…)
  const places = useBackup((s) => s.places);
  const fallback = backup && !backup.dir ? places?.find((p) => p.kind !== "icloud") : undefined;
  // proposée tant que l'utilisateur n'a pas choisi (pas en relecture d'une sauvegarde déjà réglée)
  const offerBackup = !!backup && (!!backup.dir || !!fallback) && !backup.decided;
  // « iCloud Drive », « Dropbox »… ; vide pour un dossier ordinaire
  const cloudName = backup?.dir ? (backup.icloud ? "iCloud Drive" : isCloud(backup.place) ? backup.place.name : "") : (fallback?.name ?? "");
  // là où l'on cherche une sauvegarde à restaurer : seulement l'emplacement retenu
  const hereName = backup?.dir ? cloudName : "";

  useEffect(() => {
    if (isTauri) {
      void useBackup.getState().refresh();
      void useBackup.getState().loadPlaces();
    }
  }, []);

  // parallaxe douce : le ciel suit légèrement le pointeur
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 40, damping: 20 });
  const sy = useSpring(my, { stiffness: 40, damping: 20 });
  const skyX = useTransform(sx, (v) => v * -36);
  const skyY = useTransform(sy, (v) => v * -24);
  const orbX = useTransform(sx, (v) => v * 10);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const motes = useMemo(
    () =>
      Array.from({ length: 34 }).map((_, i) => ({
        left: `${(i * 41 + 7) % 100}%`,
        top: `${48 + ((i * 29) % 50)}%`,
        delay: `${(i * 0.83) % 12}s`,
        dur: `${10 + (i % 6)}s`,
      })),
    [],
  );

  // géométrie de l'astre selon l'étape
  const orbCenter = n === 0 ? H * 0.32 : n === 4 ? H * 0.3 : 58;
  const orbSize = n === 0 ? 132 : n === 4 ? 104 : 46;
  const horizonY = H * 0.32 + 92;
  const showHorizon = n === 0 || n === 4;

  const startDownload = () => {
    const p = PROFILES.find((x) => x.id === profile)!;
    void setSetting("llm_model", p.llm);
    void setSetting("asr_model", p.asr);
    if (!models.find((m) => m.id === p.llm)?.installed) void download(p.llm);
    setN(4);
  };

  const startBloom = () => {
    const r = orbRef.current?.getBoundingClientRect();
    setBloom({ x: r ? r.left + r.width / 2 : window.innerWidth / 2, y: r ? r.top + r.height / 2 : window.innerHeight / 3 });
  };

  // ---------- retrouver une progression ----------

  const search = async () => {
    setFound(null);
    setSearchError("");
    try {
      const list = (await api().backupList()).filter((b) => !b.newer);
      setFound(list);
      setPicked(list[0]?.key ?? null);
    } catch (e) {
      setFound([]);
      setSearchError(errorText(e));
    }
  };

  const openRestore = () => {
    useBackup.setState({ restoreError: "" });
    setN(5);
    if (isTauri) void search();
  };

  const chooseFolder = async () => {
    const dir = await pickBackupFolder();
    if (!dir) return;
    await setSetting("backup_dir", dir);
    await useBackup.getState().refresh();
    void search();
  };

  // la sauvegarde d'un autre Mac peut être dans un autre nuage que celui de ce Mac
  const otherPlaces = (places ?? []).filter((p) => (p.kind === "icloud" ? !backup?.icloud : !inFolder(backup?.dir ?? "", p.path) || backup?.dir === p.path));
  const searchIn = async (p: NonNullable<typeof places>[number]) => {
    const dir = await placeDir(p);
    if (dir === null) return;
    await setSetting("backup_dir", dir);
    await useBackup.getState().refresh();
    void search();
  };

  const doRestore = async () => {
    const info = found?.find((b) => b.key === picked);
    if (!info) return;
    const r = await useBackup.getState().restore(info, null);
    if (!r) return;
    setRestored(r);
    setRestoredUser(userFrom(info.name, info.avatar, info.photo));
    // les modèles d'IA ne voyagent pas avec la sauvegarde : on propose de les télécharger
    setN(models.some((m) => m.kind === "llm" && m.installed) ? 4 : 3);
  };

  const finishRestored = async () => {
    startBloom();
    await new Promise((res) => setTimeout(res, 950));
    setReplay(false);
    // la base restaurée est relue : l'accueil laisse place à la bibliothèque
    await reloadProgress();
  };

  const finish = async () => {
    setFinishError("");
    try {
      await setSetting("user_name", meName.trim());
      await setSetting("daily_goal", String(goal));
      startBloom();
      const started = performance.now();
      await setSetting("langs", langs.join(","));
      await setSetting("lang", langs[0]);
      let first = 0;
      for (const l of langs) {
        const s = STARTERS[l];
        // pas de doublon si la leçon d'accueil existe déjà (relecture de l'accueil)
        const existing = (await api().lessonsList(l)).find((x) => x.title === s.title);
        const id = existing ? existing.id : await api().lessonCreate({ lang: l, title: s.title, text: s.text, collection: starterCollection(), kind: "text" });
        if (!first) first = id;
      }
      await refreshKnown();
      const wait = 950 - (performance.now() - started);
      if (wait > 0) await new Promise((res) => setTimeout(res, wait));
      if (isTauri && offerBackup && saveCloud && fallback) {
        const dir = await placeDir(fallback);
        if (dir !== null) await setSetting("backup_dir", dir);
      }
      if (isTauri && offerBackup) await setSetting("backup_on", saveCloud ? "1" : "0");
      // les nouveautés de cette version ne concernent pas qui découvre Wikang Tagalog
      const version = useApp.getState().info?.version.match(/\d+\.\d+\.\d+/)?.[0];
      if (version) await setSetting("seen_version", version);
      await setSetting("onboarded", "1");
      setReplay(false);
      openLesson(first);
      // puis la visite guidée, dans cette première leçon
      void useApp.getState().startTour();
      // macOS demande l'accès au nuage maintenant, juste après le choix
      if (isTauri && offerBackup && saveCloud) void useBackup.getState().save();
    } catch (error) { setBloom(null); setFinishError(errorText(error)); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && n === 0) setN(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n]);

  return (
    <div
      className="ob"
      onMouseMove={(e) => {
        mx.set(e.clientX / window.innerWidth - 0.5);
        my.set(e.clientY / window.innerHeight - 0.5);
      }}
    >
      <motion.div className="ob-sky" style={{ x: skyX, y: skyY }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.8 }}>
        <div className="ob-blob b1" />
        <div className="ob-blob b2" />
        <div className="ob-blob b3" />
        <div className="ob-blob b4" />
        <div className="ob-blob b5" />
      </motion.div>
      <div className="ob-grain" />
      <div className="ob-motes">
        {motes.map((d, i) => (
          <i key={i} style={{ left: d.left, top: d.top, animationDelay: d.delay, animationDuration: d.dur }} />
        ))}
      </div>

      <div className="ob-top drag" data-tauri-drag-region />


      <div className="ob-stage" ref={stageRef}>
        {/* l'astre se lève derrière l'horizon : on le découpe à la ligne d'horizon */}
        <div style={{ position: "absolute", left: 0, right: 0, top: -CLIP_PAD, height: horizonY + CLIP_PAD, overflow: "hidden", pointerEvents: "none", zIndex: 2 }}>
          <motion.div
            ref={orbRef}
            className="ob-orb"
            style={{ x: orbX, translateX: "-50%", translateY: "-50%" }}
            initial={false}
            animate={{ top: orbCenter + CLIP_PAD, width: orbSize, height: orbSize }}
            transition={{ type: "spring", stiffness: 70, damping: 18 }}
          >
            <motion.div
              style={{ position: "absolute", inset: 0 }}
              initial={{ y: 230, opacity: 0.4, scale: 0.85 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              transition={{ duration: 2.4, delay: 0.5, ease: EASE }}
            >
              <div className="ob-orb-rays" />
              <div className="ob-orb-halo" />
              <div className="ob-orb-core" />
            </motion.div>
          </motion.div>
        </div>

        <motion.div
          className="ob-horizon"
          style={{ top: horizonY }}
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: showHorizon ? 1 : 0.2, opacity: showHorizon ? 1 : 0 }}
          transition={{ duration: 1.4, delay: n === 0 ? 0.25 : 0, ease: EASE }}
        />

        <AnimatePresence mode="wait">
          {n === 0 && (
            <motion.div key="0" className="ob-step welcome" {...stepAnim}>
              <h1 className="ob-word" aria-label="Wikang Tagalog">
                {"Wikang Tagalog".split("").map((c, i) => (
                  <motion.span
                    key={i}
                    className="ch"
                    initial={{ opacity: 0, y: 26, filter: "blur(14px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ duration: 1.1, delay: 1.5 + i * 0.09, ease: EASE }}
                  >
                    {c}
                  </motion.span>
                ))}
                <span className="sheen" aria-hidden="true">
                  Wikang Tagalog
                </span>
              </h1>
              <motion.p className="ob-lead" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.3, duration: 1 }}>
                {/* changement de langue : le texte se fond dans le nouveau */}
                <motion.span key={ui} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.45 }}>
                  {t(
                    "Apprenez une langue comme vous avez appris la vôtre : en lisant et en écoutant ce qui vous passionne. Un mot à la fois, jusqu'à ce que tout s'éclaire.",
                    "Learn Tagalog the way you learned your own language: by reading and listening to what you love. One word at a time, until everything lights up.",
                  )}
                </motion.span>
              </motion.p>
              <motion.div className="ob-welcome-actions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.8, duration: 0.8, ease: EASE }}>
                <button className="ob-cta" onClick={() => setN(1)}>
                  {t("Commencer", "Get started")} <Icon name="forward" size={16} stroke={2} />
                </button>
                {!replay && (
                  <button className="ob-restore-link" onClick={openRestore}>
                    <Icon name="cloud" size={15} /> {t("J'ai déjà utilisé Wikang Tagalog : retrouver ma progression", "I've used Wikang Tagalog before: get my progress back")}
                  </button>
                )}
              </motion.div>
            </motion.div>
          )}

          {n === 1 && (
            <motion.div key="1" className="ob-step form" {...stepAnim}>
              <h2>{t("Faisons connaissance", "Let's get acquainted")}</h2>
              <p className="ob-sub">
                {t(
                  "Comment Wikang Tagalog peut-il vous appeler ? Votre profil reste sur ce Mac et dans votre sauvegarde : personne d'autre ne le voit.",
                  "What should Wikang Tagalog call you? Choose a name and avatar, or continue without them.",
                )}
              </p>
              <div className="ob-me">
                <motion.span
                  className="ob-me-avatar"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 18, delay: 0.15 }}
                >
                  <span className="ob-me-halo" aria-hidden="true" />
                  <Avatar size={96} spec={me.avatar} name={me.name} photo={me.photo} empty={me.empty} />
                </motion.span>
                <input
                  className="ob-name"
                  value={meName}
                  placeholder={t("Votre prénom ou un pseudo", "Your first name or a nickname")}
                  onChange={(e) => setMeName(e.target.value)}
                  onBlur={saveMeName}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    saveMeName();
                    setN(2);
                  }}
                  aria-label={t("Votre prénom ou un pseudo", "Your first name or a nickname")}
                  spellCheck={false}
                  autoComplete="off"
                  autoFocus
                />
                <ObAvatarPicker name={me.name} />
              </div>
              <div className="ob-actions">
                <button className="ob-link" onClick={() => setN(0)}>
                  {t("Retour", "Back")}
                </button>
                <button
                  className="ob-cta"
                  onClick={() => {
                    saveMeName();
                    setN(2);
                  }}
                >
                  {meName.trim() || !me.empty ? t("Continuer", "Continue") : t("Plus tard", "Later")} <Icon name="forward" size={16} stroke={2} />
                </button>
              </div>
            </motion.div>
          )}

          {n === 2 && (
            <motion.div key="2" className="ob-step form" {...stepAnim}>
              <h2>A little Tagalog, every day</h2>
              <p className="ob-sub">Choose a daily reading and listening goal. You can change it later in Settings.</p>
              <div className="ob-grid profiles" role="group" aria-label="Daily learning goal">
                {[5, 10, 20].map(minutes => <button key={minutes} className={`ob-card ${goal === minutes ? "on" : ""}`} aria-pressed={goal === minutes} onClick={() => setGoal(minutes)}><strong className="pname">{minutes} minutes</strong><span className="pdesc">{minutes === 5 ? "A small daily habit" : minutes === 10 ? "Time for a short story" : "Room to read and listen"}</span></button>)}
              </div>
              <div className="ob-actions"><button className="ob-link" onClick={() => setN(1)}>Back</button><button className="ob-cta" onClick={() => setN(3)}>Continue <Icon name="forward" size={16}/></button></div>
            </motion.div>
          )}

          {n === 3 && !isTauri && (
            <motion.div key="3web" className="ob-step form" {...stepAnim}>
              <h2>Your reading, with a little help</h2>
              <p className="ob-sub">The Tagalog–English dictionary works on this device after it loads. Context translations, chat, Simplify and natural voice use online services when configured by the site owner.</p>
              <div className="ob-explain ob-web-explain"><p><Icon name="sparkle" size={18}/> Online AI requires sign-in and an Internet connection. Your selected text, questions and attached lesson text are sent to the provider. There are no browser models to install.</p><p><Icon name="wave" size={18}/> Find prepared video and audio lessons in Discover. Admins download and transcribe media in the desktop app, then publish it for everyone to view here.</p></div>
              <div className="ob-actions"><button className="ob-link" onClick={() => setN(2)}>Back</button><button className="ob-cta" onClick={() => setN(4)}>Continue <Icon name="forward" size={16}/></button></div>
            </motion.div>
          )}

          {n === 3 && isTauri && (
            <motion.div key="3" className="ob-step form" {...stepAnim}>
              <h2>{t("Une IA qui vit sur votre Mac", "Choose your on-device AI")}</h2>
              <p className="ob-sub">
                {t(
                  "Elle traduit chaque mot dans son contexte, sans jamais rien envoyer en ligne. Le modèle se télécharge pendant que vous commencez à lire.",
                  "It translates every word in its context, on this device. The model downloads while you start reading. You can also choose an online provider later in Settings.",
                )}
              </p>
              <button className="ob-what" onClick={() => setWhat((w) => !w)} aria-expanded={what}>
                <Icon name="bulb" size={15} /> {t("Qu'est-ce qu'un modèle ?", "What is a model?")}
                <motion.span className="chev" animate={{ rotate: what ? 180 : 0 }} transition={{ duration: 0.3, ease: EASE }}>
                  <Icon name="chevron" size={14} />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {what && (
                  <motion.div
                    className="ob-explain"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.45, ease: EASE }}
                  >
                    <p>
                      {t(
                        "C'est le « cerveau » de l'IA : un gros fichier qui a lu des milliards de phrases et appris à les comprendre. Plus il est grand, plus il saisit les nuances, mais plus il pèse et plus il demande de mémoire. Il travaille sur votre Mac, même sans Internet, et vous pourrez en changer à tout moment dans les Réglages.",
                        "It's the AI's “brain”: a big file that has read billions of sentences and learned to understand them. The bigger it is, the more nuance it catches, but the more space and memory it needs. It works on your Mac, even offline, and you can switch at any time in Settings.",
                      )}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="ob-grid profiles">
                {PROFILES.map((p, i) => (
                  <motion.button
                    key={p.id}
                    className={`ob-card ${profile === p.id ? "on" : ""}`}
                    onClick={() => setProfile(p.id)}
                    onMouseMove={glow}
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + i * 0.08, duration: 0.6, ease: EASE }}
                  >
                    <span className="ob-rays">
                      {[1, 2, 3].map((r) => (
                        <i key={r} className={r <= p.rays ? "on" : ""} />
                      ))}
                    </span>
                    <strong className="pname">{p.name}</strong>
                    <span className="pdesc">{p.desc}</span>
                    <span className="psize">{formatBytes(p.size)}</span>
                  </motion.button>
                ))}
              </div>
              <div className="ob-actions">
                <button className="ob-link" onClick={() => setN(4)}>
                  {t("Plus tard", "Later")}
                </button>
                <button className="ob-cta" onClick={startDownload}>
                  <Icon name="download" size={16} stroke={2} /> {t("Télécharger et continuer", "Download and continue")}
                </button>
              </div>
            </motion.div>
          )}

          {n === 4 && restored && (
            <motion.div key="4r" className="ob-step ready" {...stepAnim}>
              {restoredUser && !restoredUser.empty && (
                <motion.span
                  className="ob-me-back"
                  initial={{ opacity: 0, scale: 0.7, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 220, damping: 18, delay: 0.25 }}
                >
                  <Avatar size={64} spec={restoredUser.avatar} name={restoredUser.name} photo={restoredUser.photo} empty={false} />
                </motion.span>
              )}
              <h2>{restoredUser?.name ? t(`Bon retour, ${restoredUser.name}`, `Welcome back, ${restoredUser.name}`) : t("Bon retour", "Welcome back")}</h2>
              <p className="ob-sub">
                {t(
                  `${formatNumber(restored.counts.known)} mots connus et ${count(restored.counts.lessons, "leçon", "leçons", "", "")} vous attendent, exactement là où vous les aviez laissés.`,
                  `${formatNumber(restored.counts.known)} known words and ${count(restored.counts.lessons, "", "", "lesson", "lessons")} are waiting for you, exactly where you left them.`,
                )}
              </p>
              <button className="ob-cta" onClick={finishRestored} disabled={!!bloom}>
                {t("Retrouver ma bibliothèque", "Back to my library")} <Icon name="library" size={16} />
              </button>
            </motion.div>
          )}

          {n === 4 && !restored && (
            <motion.div key="4" className="ob-step ready" {...stepAnim}>
              <h2>{firstName ? `${firstName}, your first story is ready` : "Your first story is ready"}</h2>
              <p className="ob-sub">
                {t(
                  "Une courte histoire vous attend dans chaque langue choisie. Touchez les mots inconnus, écoutez la page, puis terminez-la : les mots compris rejoignent votre vocabulaire.",
                  "A short Tagalog story is waiting for you. Tap the unknown words, listen to the page, then finish it: the words you understood join your vocabulary.",
                )}
              </p>
              {isTauri && offerBackup && (
                <motion.label className="ob-backup" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.6, ease: EASE }}>
                  <Icon name="cloud" size={20} />
                  <span>
                    <strong>
                      {cloudName
                        ? t(`Sauvegarder ma progression dans ${cloudName}`, `Back up my progress to ${cloudName}`)
                        : t("Sauvegarder ma progression dans le dossier choisi", "Back up my progress to the chosen folder")}
                    </strong>
                    <small>{t("Une copie à l'abri, retrouvée en un clic si ce Mac s'efface ou sur un nouveau Mac.", "A safe copy, back in one click if this Mac is wiped, or on a new Mac.")}</small>
                  </span>
                  <Switch on={saveCloud} onChange={setSaveCloud} label={t("Sauvegarder ma progression", "Back up my progress")} />
                </motion.label>
              )}
              {!isTauri && <p className="ob-sub">Start without an account and save your learning in this browser. Sign in to sync your private learning data through Supabase. The guided tour will show you how to read, listen and track new words.</p>}
              {finishError && <p className="ob-error" role="alert">{finishError}</p>}
              <button className="ob-cta" onClick={() => void finish()} disabled={!!bloom || !langs.length}>
                {t("Ouvrir ma première lecture", "Open my first reading")} <Icon name="book" size={16} />
              </button>
              <div className="ob-actions"><button className="ob-link" onClick={() => setN(3)}>Back</button>{!isTauri && <button className="ob-link" onClick={() => setN(5)}>Sign in first</button>}</div>
            </motion.div>
          )}

          {n === 5 && !isTauri && (
            <motion.div key="5web" className="ob-step form ob-account" {...stepAnim}>
              <Account/>
              <button className="ob-link" onClick={() => setN(0)}>Back to the welcome</button>
            </motion.div>
          )}

          {n === 5 && isTauri && (
            <motion.div key="5" className="ob-step form" {...stepAnim}>
              <h2>{t("Retrouver ma progression", "Get my progress back")}</h2>
              <p className="ob-sub">{t("Vos mots, vos expressions, vos leçons et vos réglages reviennent tels que vous les aviez laissés.", "Your words, phrases, lessons and settings come back just as you left them.")}</p>
              {restoring ? (
                <div className="ob-restoring">
                  <Orb size={30} />
                  <strong>{restoreStage(restoring.stage) ?? t("Restauration…", "Restoring…")}</strong>
                  <div className="ob-progress">
                    <i style={{ width: `${restoring.stage === "media" ? 8 + restoring.value * 92 : restoring.stage === "apply" ? 100 : 8}%` }} />
                  </div>
                </div>
              ) : found === null ? (
                <div className="ob-search">
                  <Orb size={20} />{" "}
                  {backup?.icloud === false
                    ? hereName
                      ? t(`Recherche dans ${hereName}…`, `Searching ${hereName}…`)
                      : t("Recherche dans le dossier choisi…", "Searching the chosen folder…")
                    : t("Recherche dans votre iCloud Drive…", "Searching your iCloud Drive…")}
                </div>
              ) : found.length ? (
                <div className="ob-grid backups">
                  {found.map((b, i) => (
                    <motion.button
                      key={b.key}
                      className={`ob-card backup ${picked === b.key ? "on" : ""}`}
                      onClick={() => setPicked(b.key)}
                      onMouseMove={glow}
                      aria-pressed={picked === b.key}
                      initial={{ opacity: 0, y: 18 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + i * 0.07, duration: 0.6, ease: EASE }}
                    >
                      <BackupWho b={b} />
                      <strong className="pname">{count(b.counts.known, "mot connu", "mots connus", "known word", "known words")}</strong>
                      <span className="pdesc">
                        {count(b.counts.lessons, "leçon", "leçons", "lesson", "lessons")}
                        {b.counts.langs.length ? t(` en ${b.counts.langs.map((l) => langLower(l)).join(", ")}`, ` in ${b.counts.langs.map((l) => langLower(l)).join(", ")}`) : ""}
                        <br />
                        {t(`Sauvegardée ${formatWhen(b.saved_at)}`, `Backed up ${formatWhen(b.saved_at)}`)}
                      </span>
                      <AnimatePresence>
                        {picked === b.key && (
                          <motion.span className="tick" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: "spring", stiffness: 500, damping: 22 }}>
                            <Icon name="check" size={14} stroke={2.6} />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </motion.button>
                  ))}
                </div>
              ) : (
                <p className="ob-empty">
                  {searchError ||
                    (backup?.icloud === false
                      ? hereName
                        ? t(`Aucune sauvegarde de Wikang Tagalog dans ${hereName}.`, `No Wikang Tagalog backup in ${hereName}.`)
                        : t("Aucune sauvegarde de Wikang Tagalog dans ce dossier.", "No Wikang Tagalog backup in this folder.")
                      : t("Aucune sauvegarde de Wikang Tagalog dans votre iCloud Drive.", "No Wikang Tagalog backup in your iCloud Drive."))}
                </p>
              )}
              {restoreError && !restoring && <p className="ob-error">{restoreError}</p>}
              <div className="ob-actions">
                <button className="ob-link" onClick={() => setN(0)} disabled={!!restoring}>
                  {t("Retour", "Back")}
                </button>
                {found !== null && !found.length ? (
                  <>
                    {otherPlaces.slice(0, 3).map((p) => (
                      <button key={p.path || p.kind} className="ob-link" onClick={() => void searchIn(p)}>
                        {t(`Chercher dans ${p.name}`, `Look in ${p.name}`)}
                      </button>
                    ))}
                    <button className="ob-link" onClick={chooseFolder}>
                      {t("Choisir un dossier…", "Choose a folder…")}
                    </button>
                    <button className="ob-cta" onClick={() => setN(1)}>
                      {t("Commencer sans sauvegarde", "Start without a backup")} <Icon name="forward" size={16} stroke={2} />
                    </button>
                  </>
                ) : (
                  <button className="ob-cta" onClick={doRestore} disabled={!picked || !!restoring || found === null}>
                    {t("Restaurer", "Restore")} <Icon name="forward" size={16} stroke={2} />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="ob-dots" role="status" aria-label={n === 5 ? "Recover your learning" : `Welcome step ${n + 1} of 5`}>
        {/* la restauration (étape 5) n'a pas de point : elle remplace les étapes 1 à 4 */}
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} className={i === n ? "on" : ""} />
        ))}
      </div>

      {bloom && (
        <motion.div
          className="ob-bloom"
          style={{ left: bloom.x, top: bloom.y }}
          initial={{ scale: 0.4, opacity: 0.6 }}
          animate={{ scale: Math.max(window.innerWidth, window.innerHeight) / 40, opacity: 1 }}
          transition={{ duration: 1.1, ease: [0.7, 0, 0.3, 1] }}
        />
      )}
    </div>
  );
}

/** Choix de l'avatar à l'accueil : la photo, l'initiale ou une lumière, puis sa teinte. */
function ObAvatarPicker({ name }: { name: string }) {
  const avatar = useApp((s) => s.settings.user_avatar ?? "");
  const photo = useApp((s) => s.settings.user_photo ?? "");
  const setSetting = useApp((s) => s.setSetting);
  const toast = useApp((s) => s.toast);
  const me = userFrom(name, avatar, photo);
  // rien de choisi : aucune option n'est allumée
  const current: AvatarStyle | null = avatar ? me.avatar.style : null;
  // pas encore de graine : celle des aperçus, pour que la lumière choisie soit bien celle qu'on a vue
  const [fallback] = useState(newSeed);
  const seed = me.avatar.seed || fallback;
  const set = (style: AvatarStyle, hue = me.avatar.hue) => void setSetting("user_avatar", avatarString({ style, hue, seed }));

  const pickPhoto = async () => {
    try {
      const data = await choosePhoto();
      if (!data) return;
      await setSetting("user_photo", data);
      set("photo");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  return (
    <motion.div className="ob-me-picker" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.6, ease: EASE }}>
      <div className="ob-me-styles" role="radiogroup" aria-label={t("Avatar", "Avatar")}>
        <button
          role="radio"
          aria-checked={current === "photo"}
          className={`ob-me-opt ${current === "photo" ? "on" : ""}`}
          onClick={() => (photo && current !== "photo" ? set("photo") : void pickPhoto())}
          title={photo ? t("Votre photo (toucher à nouveau pour en changer)", "Your photo (tap again to change it)") : t("Choisir une photo…", "Choose a photo…")}
        >
          <span className={`avatar ${photo ? "" : "ob-me-nophoto"}`} style={{ width: 42, height: 42 }}>
            {photo ? <img className="avatar-img" src={photo} alt="" draggable={false} /> : <Icon name="image" size={17} />}
          </span>
        </button>
        {avatarStyles().map((s) => (
          <button key={s.id} role="radio" aria-checked={current === s.id} className={`ob-me-opt ${current === s.id ? "on" : ""}`} onClick={() => set(s.id)} title={s.label}>
            <span className="avatar" style={{ width: 42, height: 42 }}>
              <AvatarArt spec={{ style: s.id, hue: me.avatar.hue, seed }} name={name} />
            </span>
          </button>
        ))}
      </div>
      <div className="ob-me-hues" role="radiogroup" aria-label={t("Teinte", "Hue")}>
        {HUES.map((h) => (
          <button
            key={h}
            role="radio"
            aria-checked={me.avatar.hue === h}
            aria-label={t(`Teinte ${h}°`, `Hue ${h}°`)}
            className={`me-hue ${me.avatar.hue === h ? "on" : ""}`}
            style={{ ["--h" as string]: h }}
            onClick={() => set(current && current !== "photo" ? current : "initial", h)}
          />
        ))}
      </div>
    </motion.div>
  );
}

/** Une sauvegarde trouvée à l'accueil : l'avatar et le nom de son profil, sinon le Mac. */
function BackupWho({ b }: { b: BackupInfo }) {
  const who = userFrom(b.name, b.avatar, b.photo);
  return (
    <span className="ob-device">
      {who.empty ? <Icon name="laptop" size={15} /> : <Avatar size={22} spec={who.avatar} name={who.name} photo={who.photo} empty={false} />}
      {who.name ? t(`${who.name} · ${b.device_name}`, `${who.name} · ${b.device_name}`) : b.device_name}
    </span>
  );
}
