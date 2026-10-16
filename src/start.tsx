// The app itself: the desktop app (and, in development, its browser preview: main.tsx).
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { api, initApi, isTauri } from "./lib/api";
import { isWindows } from "./lib/platform";
import { useApp } from "./lib/store";
// sous Windows : boutons de la fenêtre, barres de défilement fines, polices de repli (styles .win)
// the frameless-window chrome only exists in the desktop app
if (isWindows && "__TAURI_INTERNALS__" in window) document.documentElement.classList.add("win");

/**
 * Polices chargées avant le premier affichage : sinon titres et extraits
 * changent de hauteur à leur arrivée (« swap ») et les cartes de la
 * bibliothèque sautent. Une seconde et demie au plus, puis on affiche quand même.
 */
function fontsReady(): Promise<unknown> {
  if (!document.fonts?.load) return Promise.resolve();
  const wanted = ['500 21px "Newsreader Variable"', '400 16px "Literata Variable"', '400 14px "Geist Variable"'];
  const all = Promise.all(wanted.map((f) => document.fonts.load(f).catch(() => null)));
  return Promise.race([all, new Promise((r) => setTimeout(r, 1500))]);
}

Promise.all([initApi(), fontsReady()]).then(() => {
  // accès de test dans l'aperçu navigateur (jamais dans l'application)
  if (import.meta.env.DEV && !isTauri) (window as unknown as Record<string, unknown>).__wikang = { api, useApp };
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
