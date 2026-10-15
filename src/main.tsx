import "@fontsource-variable/geist";
import "@fontsource-variable/literata";
import "@fontsource-variable/literata/wght-italic.css";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/newsreader/wght-italic.css";
import "./styles/app.css";
import "./styles/views.css";
import "./styles/reader.css";
import "./styles/onboarding.css";
import "./styles/chat.css";
import "./styles/guide.css";
import "./styles/discover.css";
import "./styles/preview.css";
import "./styles/news.css";
import "./styles/tagalog.css";
import "./styles/tour.css";
import "./styles/mobile.css";
import "./styles/landing.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { Landing } from "./views/Landing";

// Wikang Tagalog is a desktop app; wikangtagalog.com is where it is downloaded, and loads none of
// the app. In development, /?app opens the shared interface in the browser (its browser backend),
// for the browser tests.
const isDesktop = "__TAURI_INTERNALS__" in window;
const appHere = isDesktop || (import.meta.env.DEV && new URLSearchParams(location.search).has("app"));

if (appHere) void import("./start");
else {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Landing />
    </React.StrictMode>,
  );
}

// Keep startup errors visible, including unavailable browser storage.
window.addEventListener("unhandledrejection", (event) => {
  if (document.getElementById("root")?.childElementCount) return;
  const root=document.getElementById("root");if (!root) return;
  const p=document.createElement("p");p.textContent="Wikang Tagalog could not start. " + (event.reason?.message ?? String(event.reason));
  const button=document.createElement("button");button.textContent="Retry";button.onclick=()=>location.reload();root.append(p,button);
});
