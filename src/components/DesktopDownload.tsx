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

/** "Download for Windows" (or Mac) for this computer, and the other one beside it. */
export function DesktopDownload() {
  const here = desktopPlatform();
  if (!here)
    return (
      <span className="desktop-dl">
        <span className="muted desktop-dl-note">Wikang Tagalog runs on your computer:</span>
        <a className="btn sm soft" href={downloadUrl("windows")}>
          <Icon name="download" size={14} /> Windows
        </a>
        <a className="btn sm soft" href={downloadUrl("mac")}>
          <Icon name="download" size={14} /> Mac
        </a>
      </span>
    );
  const other: DesktopPlatform = here === "mac" ? "windows" : "mac";
  return (
    <span className="desktop-dl">
      <a className="btn primary" href={downloadUrl(here)}>
        <Icon name="download" size={15} /> Download for {NAMES[here]}
      </a>
      <a className="link-btn" href={downloadUrl(other)}>
        {NAMES[other]} instead
      </a>
    </span>
  );
}
