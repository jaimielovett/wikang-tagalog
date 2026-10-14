// Wikang Tagalog's icon and link preview, rendered from design/ on any computer (Playwright's Chrome):
//   design/icon.mjs → icon.svg (Apple's rounded shape) → design/icon-1024.png → src-tauri/icons/ (every size)
//   design/icon-full.svg → public/favicon.svg, favicon-32.png, favicon.ico, apple-touch-icon.png, icon-512.png
//   design/og.html → public/og.png (the preview shown when a link is shared)
//   node scripts/brand.mjs
// scripts/design.mjs still renders the macOS installer images and the Windows installer bitmaps.
import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const design = join(root, "design");
const icons = join(root, "src-tauri", "icons");
const pub = join(root, "public");
const step = (s) => console.log(`› ${s}`);

step("Drawing the icon");
execFileSync(process.execPath, [join(design, "icon.mjs")], { stdio: "inherit" });

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
/** An SVG file rendered at `size` pixels, transparent around its shape. */
async function svg(file, out, size) {
  await page.setViewportSize({ width: size, height: size });
  const doc = readFileSync(file, "utf8").replace(/width="1024" height="1024"/, `width="${size}" height="${size}"`);
  await page.setContent(`<html><body style="margin:0;background:transparent">${doc}</body></html>`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

step("Rendering the app icon");
const big = join(design, "icon-1024.png");
await svg(join(design, "icon.svg"), big, 1024);

step("Rendering the web icons");
copyFileSync(join(design, "icon-full.svg"), join(pub, "favicon.svg"));
await svg(join(design, "icon-full.svg"), join(pub, "favicon-32.png"), 32);
await svg(join(design, "icon-full.svg"), join(pub, "apple-touch-icon.png"), 180);
await svg(join(design, "icon-full.svg"), join(pub, "icon-512.png"), 512);

step("Rendering the link preview");
await page.setViewportSize({ width: 1200, height: 630 });
await page.goto(pathToFileURL(join(design, "og.html")).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(pub, "og.png"), clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();

step("Installing the app icon at every size");
const tmp = mkdtempSync(join(tmpdir(), "wikang-icons-"));
execSync(`npx tauri icon "${big}" -o "${tmp}"`, { cwd: root, stdio: "ignore" });
// only the files the app already uses (tauri icon also writes mobile sets)
for (const f of readdirSync(icons)) {
  const src = join(tmp, f);
  if (existsSync(src) && statSync(src).isFile()) copyFileSync(src, join(icons, f));
}
copyFileSync(join(icons, "icon.ico"), join(pub, "favicon.ico"));
rmSync(tmp, { recursive: true, force: true });
console.log("✓ icons, web icons and link preview");
