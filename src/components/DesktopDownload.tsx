import { useEffect, useState } from "react";
import { Icon } from "./Icon";

export type DesktopPlatform = "windows" | "mac";

/** The computer this browser runs on, if the desktop app is made for it (not phones, not Linux). */
export function desktopPlatform(): DesktopPlatform | null {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|Android/i.test(ua)) return null;
  // an iPad asking for the desktop site says "Macintosh" but has a touch screen
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return null;
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  return null;
}

/** The installer, straight from the latest published release (api/download.mjs). */
export const downloadUrl = (p: DesktopPlatform) => `/api/download?platform=${p}`;

const NAMES: Record<DesktopPlatform, string> = { windows: "Windows", mac: "Mac" };

/** The latest published version (api/download.mjs ?latest), once known. */
function useLatestVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/download?latest")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { version?: string | null } | null) => alive && setVersion(d?.version ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return version;
}

/** "Download v0.1.3 for Windows" (or Mac) for this computer, and the other one beside it. */
export function DesktopDownload() {
  const here = desktopPlatform();
  const version = useLatestVersion();
  const v = version ? ` v${version}` : "";
  if (!here)
    return (
      <span className="desktop-dl">
        <span className="muted desktop-dl-note">Wikang Tagalog runs on your computer:</span>
        <a className="btn sm soft" href={downloadUrl("windows")}>
          <Icon name="download" size={14} /> Windows{v}
        </a>
        <a className="btn sm soft" href={downloadUrl("mac")}>
          <Icon name="download" size={14} /> Mac{v}
        </a>
      </span>
    );
  const other: DesktopPlatform = here === "mac" ? "windows" : "mac";
  return (
    <span className="desktop-dl">
      <a className="btn primary" href={downloadUrl(here)}>
        <Icon name="download" size={15} /> Download{v} for {NAMES[here]}
      </a>
      <a className="link-btn" href={downloadUrl(other)}>
        {NAMES[other]} instead
      </a>
    </span>
  );
}
