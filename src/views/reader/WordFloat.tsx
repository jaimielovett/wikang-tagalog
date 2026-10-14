import { motion } from "motion/react";
import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { t } from "../../lib/i18n";

/** Largeur de la carte, marge aux bords de la colonne, écart avec le mot. */
const CARD_W = 344;
const EDGE = 12;
const GAP = 12;
/** Hauteur habituelle d'une carte complète (mot, sens, statut, ma traduction). */
const FULL_H = 360;

interface Place {
  /** coin gauche de la carte et ligne d'attache (haut ou bas du mot), dans la colonne de lecture */
  left: number;
  y: number;
  width: number;
  /** au-dessus du mot (sinon dessous) */
  up: boolean;
  maxH: number;
  /** pointe de la carte, depuis son bord gauche */
  tip: number;
  /** on a phone: a sheet the screen's width, at the foot of the screen (or its top, for a word low down) */
  sheet?: "top" | "bottom";
}

/** Phones get a sheet: a card squeezed between a word and the screen's edge is too small to use. */
const onPhone = () => window.matchMedia("(max-width: 700px)").matches;
/** The sheet never takes less than this share of the screen, nor more than this one. */
const SHEET_MIN = 0.42;
const SHEET_MAX = 0.62;

interface Props {
  /** colonne de lecture : repère des positions, barre du haut et lecteur audio */
  col: RefObject<HTMLDivElement | null>;
  /** page affichée, où sont les mots */
  page: RefObject<HTMLDivElement | null>;
  /** zone qui défile (mode défilement) : la carte suit le mot */
  scroller: RefObject<HTMLDivElement | null>;
  /** premier et dernier mot sélectionnés */
  a: number;
  b: number;
  /** ce qui déplace les mots sans redimensionner la colonne (page, police, mise en page) */
  layout: string;
  children: ReactNode;
}

/**
 * Panneau du mot flottant : une carte posée au-dessus du mot touché (dessous
 * s'il n'y a pas la place), pour laisser toute la largeur au texte. Elle suit
 * le mot quand la sélection change, quand la fenêtre change de taille ou quand
 * le texte défile, et attend, invisible, un mot sorti de la vue.
 */
export function WordFloat({ col, page, scroller, a, b, layout, children }: Props) {
  // dernière position connue, et si le mot est en vue
  const [place, setPlace] = useState<Place | null>(null);
  const [seen, setSeen] = useState(false);

  useLayoutEffect(() => {
    const box = col.current;
    if (!box) return;
    const measure = () => {
      const ea = page.current?.querySelector<HTMLElement>(`[data-i="${a}"]`);
      const eb = page.current?.querySelector<HTMLElement>(`[data-i="${b}"]`) ?? ea;
      if (!ea || !eb) return setSeen(false);
      const c = box.getBoundingClientRect();
      const ra = ea.getBoundingClientRect();
      const rb = eb.getBoundingClientRect();
      const top = Math.min(ra.top, rb.top) - c.top;
      const bottom = Math.max(ra.bottom, rb.bottom) - c.top;
      // place libre : sous la barre du haut (et la vidéo d'une leçon vidéo), au-dessus du lecteur audio
      const over = [".reader-top", ".video-stage"].map((sel) => box.querySelector(sel)?.getBoundingClientRect().bottom ?? c.top);
      const minY = Math.max(...over) - c.top + EDGE;
      const maxY = (box.querySelector(".player")?.getBoundingClientRect().top ?? c.bottom) - c.top - EDGE;
      // mot sorti de la vue (défilement) : la carte attend qu'il revienne
      if (bottom < minY || top > maxY) return setSeen(false);
      if (onPhone()) {
        // the sheet takes the half of the screen the word is not in
        const h = window.innerHeight;
        const wordTop = Math.min(ra.top, rb.top);
        const wordBottom = Math.max(ra.bottom, rb.bottom);
        const low = (wordTop + wordBottom) / 2 > h / 2;
        const room = low ? wordTop - EDGE : h - wordBottom - EDGE;
        const maxH = Math.round(Math.min(h * SHEET_MAX, Math.max(h * SHEET_MIN, room)));
        const next: Place = { left: 0, y: 0, width: 0, up: !low, maxH, tip: 0, sheet: low ? "top" : "bottom" };
        setSeen(true);
        setPlace((p) => (p && p.sheet === next.sheet && p.maxH === next.maxH ? p : next));
        return;
      }
      // sur une ligne : le milieu du passage ; sur plusieurs : son premier mot
      const oneLine = Math.abs(ra.top - rb.top) < ra.height / 2;
      const x = (oneLine ? (Math.min(ra.left, rb.left) + Math.max(ra.right, rb.right)) / 2 : ra.left + ra.width / 2) - c.left;
      const above = top - GAP - minY;
      const below = maxY - bottom - GAP;
      // au-dessus du mot s'il y a la place d'une carte entière (elle cache alors ce qu'on
      // a déjà lu, pas la suite) ; sinon du côté le plus grand
      const up = above >= FULL_H || above >= below;
      const width = Math.min(CARD_W, c.width - EDGE * 2);
      const left = Math.min(Math.max(x - width / 2, EDGE), c.width - width - EDGE);
      const next: Place = {
        left: Math.round(left),
        y: Math.round(up ? top - GAP : bottom + GAP),
        width,
        up,
        maxH: Math.max(140, Math.round(up ? above : below)),
        tip: Math.round(Math.min(Math.max(x - left, 22), width - 22)),
      };
      setSeen(true);
      setPlace((p) => (p && p.left === next.left && p.y === next.y && p.width === next.width && p.up === next.up && p.maxH === next.maxH && p.tip === next.tip ? p : next));
    };
    let raf = 0;
    const later = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    measure();
    const sc = scroller.current;
    sc?.addEventListener("scroll", later, { passive: true });
    const ro = new ResizeObserver(later);
    ro.observe(box);
    // la page se compose ou tourne : les mots arrivent un instant après
    const settle = window.setTimeout(later, 380);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      sc?.removeEventListener("scroll", later);
      ro.disconnect();
    };
  }, [col, page, scroller, a, b, layout]);

  if (place?.sheet)
    return (
      <div key="sheet" className={`wp-float-at sheet ${place.sheet} ${seen ? "" : "gone"}`}>
        <motion.div
          className="wp-float sheet"
          data-tour="panel"
          role="dialog"
          aria-label={t("Détail du mot", "Word details")}
          style={{ maxHeight: place.maxH }}
          initial={{ opacity: 0, scale: 1, y: place.sheet === "bottom" ? 40 : -40 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, y: place.sheet === "bottom" ? 40 : -40, transition: { duration: 0.16 } }}
          transition={{ type: "spring", stiffness: 480, damping: 40 }}
        >
          {children}
        </motion.div>
      </div>
    );

  return (
    <div
      className={`wp-float-at ${place && seen ? "" : "gone"}`}
      // première position : posée d'emblée ; ensuite, la carte glisse d'un mot à l'autre
      style={place ? { left: place.left, top: place.y, width: place.width } : undefined}
    >
      <motion.div
        className={`wp-float ${place?.up === false ? "down" : "up"}`}
        data-tour="panel"
        role="dialog"
        aria-label={t("Détail du mot", "Word details")}
        style={{ maxHeight: place?.maxH, transformOrigin: `${place?.tip ?? 172}px ${place?.up === false ? "0%" : "100%"}` }}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.14 } }}
        transition={{ type: "spring", stiffness: 520, damping: 36, mass: 0.7 }}
      >
        <span className="wp-float-tip" style={{ left: place?.tip ?? 172 }} aria-hidden="true" />
        {children}
      </motion.div>
    </div>
  );
}
