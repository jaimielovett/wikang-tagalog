// Wikang Tagalog's icon and link preview, rendered from design/ on any computer (Playwright's Chrome):
//   design/icon.mjs → icon.svg (Apple's rounded shape) → design/icon-1024.png → src-tauri/icons/ (every size)
//   design/icon-full.svg → public/favicon.svg, favicon-32.png, favicon.ico, apple-touch-icon.png, icon-512.png
//   design/og.html → public/og.png (the preview shown when a link is shared)
//   design/dmg-background.html → src-tauri/dmg/background.png (2x, marked 144 dpi: sharp on Retina)
//   design/nsis-sidebar.html, nsis-header.html → src-tauri/nsis/*.bmp (the Windows installer's images)
//   node scripts/brand.mjs
// scripts/design.mjs does the same on a Mac with its own tools.
import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { crc32 } from "node:zlib";
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

step("Rendering the macOS installer window");
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
/** The PNG marked `dpi` dots per inch (a pHYs chunk after IHDR): 144 makes Finder show a 2x image at its size. */
function withDpi(png, dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const body = Buffer.concat([u32(ppm), u32(ppm), Buffer.from([1])]);
  const type = Buffer.from("pHYs");
  return Buffer.concat([png.subarray(0, 33), u32(body.length), type, body, u32(crc32(Buffer.concat([type, body]))), png.subarray(33)]);
}
const retina = await browser.newPage({ viewport: { width: 660, height: 420 }, deviceScaleFactor: 2 });
await retina.goto(pathToFileURL(join(design, "dmg-background.html")).href);
await retina.evaluate(() => document.fonts.ready);
writeFileSync(join(root, "src-tauri", "dmg", "background.png"), withDpi(await retina.screenshot(), 144));
await retina.close();

step("Rendering the Windows installer images");
/** A 24-bit BMP (what NSIS reads) of an HTML page, composited on white like the installer's pages. */
async function bmp(file, out, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  const png = (await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } })).toString("base64");
  const rgba = await page.evaluate(async ([src, w, h]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(0, 0, w, h).data);
  }, [png, w, h]);
  const row = Math.ceil((w * 3) / 4) * 4;
  const px = Buffer.alloc(row * h);
  // BMP rows run bottom to top, in blue-green-red order
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = (h - 1 - y) * row + x * 3;
      px[o] = rgba[i + 2];
      px[o + 1] = rgba[i + 1];
      px[o + 2] = rgba[i];
    }
  const head = Buffer.alloc(54);
  head.write("BM", 0);
  head.writeUInt32LE(54 + px.length, 2);
  head.writeUInt32LE(54, 10);
  head.writeUInt32LE(40, 14);
  head.writeInt32LE(w, 18);
  head.writeInt32LE(h, 22);
  head.writeUInt16LE(1, 26);
  head.writeUInt16LE(24, 28);
  head.writeUInt32LE(px.length, 34);
  head.writeInt32LE(2835, 38);
  head.writeInt32LE(2835, 42);
  writeFileSync(out, Buffer.concat([head, px]));
}
await bmp(join(design, "nsis-sidebar.html"), join(root, "src-tauri", "nsis", "sidebar.bmp"), 164, 314);
await bmp(join(design, "nsis-header.html"), join(root, "src-tauri", "nsis", "header.bmp"), 150, 57);
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
console.log("✓ icons, web icons, link preview and installer images");
