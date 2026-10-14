// Wikang Tagalog's icon: Lumen's sun over an open book, set on the Philippine flag (blue over red,
// a white triangle at the hoist with three gold stars; the sun keeps the flag's eight rays).
// Drawn as vectors, so it stays sharp from 16 px to 1024 px. Writes icon.svg (Apple's rounded
// shape, 824 in 1024) and icon-full.svg (the same art filling the square: web and touch icons).
// Rendered to PNG and installed by `node scripts/brand.mjs`.
import { writeFileSync } from "node:fs";

const f = (n) => Math.round(n * 100) / 100;

// Apple's shape: a square with continuous corners (60 % smoothing), 824 in 1024
function squircle(x, y, w, h, r, s = 0.6) {
  const rad = (d) => (d * Math.PI) / 180;
  const p = (1 + s) * r;
  const arc = 90 * (1 - s);
  const arcLen = Math.sin(rad(arc / 2)) * r * Math.SQRT2;
  const alpha = (90 - arc) / 2;
  const p34 = r * Math.tan(rad(alpha / 2));
  const beta = 45 * s;
  const c = p34 * Math.cos(rad(beta));
  const d = c * Math.tan(rad(beta));
  const b = (p - arcLen - c - d) / 3;
  const a = 2 * b;
  const A = f(a), B = f(a + b), C = f(a + b + c), D = f(d), L = f(arcLen), R = f(r), c_ = f(c), bc = f(b + c);
  return [
    `M${f(x + w - p)} ${y}`, `c${A} 0 ${B} 0 ${C} ${D}`, `a${R} ${R} 0 0 1 ${L} ${L}`, `c${D} ${c_} ${D} ${bc} ${D} ${C}`,
    `L${x + w} ${f(y + h - p)}`, `c0 ${A} 0 ${B} ${-D} ${C}`, `a${R} ${R} 0 0 1 ${-L} ${L}`, `c${-c_} ${D} ${-bc} ${D} ${-C} ${D}`,
    `L${f(x + p)} ${y + h}`, `c${-A} 0 ${-B} 0 ${-C} ${-D}`, `a${R} ${R} 0 0 1 ${-L} ${-L}`, `c${-D} ${-c_} ${-D} ${-bc} ${-D} ${-C}`,
    `L${x} ${f(y + p)}`, `c0 ${-A} 0 ${-B} ${D} ${-C}`, `a${R} ${R} 0 0 1 ${L} ${-L}`, `c${c_} ${-D} ${bc} ${-D} ${C} ${-D}`, "Z",
  ].join(" ");
}

/** A five-pointed star centred on (x, y). */
function star(x, y, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.42 : r;
    pts.push(`${f(x + rr * Math.cos(a))},${f(y + rr * Math.sin(a))}`);
  }
  return pts.join(" ");
}

/** The sun's rays: eight long ones, as on the flag, and eight short ones between them. */
function rays(cx, cy, from, to, width, count, offset) {
  return Array.from({ length: count }, (_, i) => {
    const a = (Math.PI * 2 * i) / count + offset;
    const along = (r) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const side = (r, w) => [-Math.sin(a) * w, Math.cos(a) * w];
    const [x0, y0] = along(from);
    const [x1, y1] = along(to);
    const [dx, dy] = side(from, width);
    return `M${f(x0 + dx)} ${f(y0 + dy)} L${f(x1)} ${f(y1)} L${f(x0 - dx)} ${f(y0 - dy)} Z`;
  }).join(" ");
}

const SUN = { x: 540, y: 400, r: 178 };

// the art, drawn on the full 1024 square; each icon clips it to its own shape
const art = `
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0a3290"/>
      <stop offset="0.48" stop-color="#1c4db6"/>
      <stop offset="0.64" stop-color="#b8192f"/>
      <stop offset="1" stop-color="#8a1022"/>
    </linearGradient>
    <linearGradient id="tri" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.78"/>
      <stop offset="0.75" stop-color="#ffffff" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.08"/>
    </linearGradient>
    <radialGradient id="glow" cx="${SUN.x}" cy="${SUN.y}" r="380" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffd86e" stop-opacity="0.7"/>
      <stop offset="0.5" stop-color="#ffc24a" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#ffc24a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="beam" cx="${SUN.x}" cy="${SUN.y}" r="420" gradientUnits="userSpaceOnUse">
      <stop offset="0.4" stop-color="#ffe08a" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#ffe08a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="sun" cx="0.38" cy="0.32" r="0.75">
      <stop offset="0" stop-color="#fff7d6"/>
      <stop offset="0.35" stop-color="#ffdc63"/>
      <stop offset="0.8" stop-color="#f7a928"/>
      <stop offset="1" stop-color="#e88c14"/>
    </radialGradient>
    <linearGradient id="page-l" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#f6dca0"/><stop offset="1" stop-color="#fff7e0"/>
    </linearGradient>
    <linearGradient id="page-r" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff2d0"/><stop offset="1" stop-color="#f3d38e"/>
    </linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6ad3b"/><stop offset="1" stop-color="#df8318"/>
    </linearGradient>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>
  </defs>
  <rect width="1024" height="1024" fill="url(#sky)"/>
  <polygon points="-160,-160 500,512 -160,1184" fill="url(#tri)" filter="url(#soft)"/>
  <circle cx="${SUN.x}" cy="${SUN.y}" r="380" fill="url(#glow)"/>
  <path d="${rays(SUN.x, SUN.y, SUN.r - 6, 420, 26, 8, -Math.PI / 2)}" fill="url(#beam)"/>
  <path d="${rays(SUN.x, SUN.y, SUN.r - 6, 320, 12, 8, -Math.PI / 2 + Math.PI / 8)}" fill="url(#beam)" fill-opacity="0.6"/>
  <circle cx="${SUN.x}" cy="${SUN.y}" r="${SUN.r}" fill="url(#sun)"/>
  <polygon points="${star(170, 170, 30)}" fill="#ffd34d"/>
  <polygon points="${star(158, 622, 28)}" fill="#ffd34d"/>
  <polygon points="${star(318, 520, 24)}" fill="#ffd34d"/>
  <path d="M0 790 C 190 752, 410 760, 512 850 C 614 760, 834 752, 1024 790 L 1024 1024 L 0 1024 Z" fill="url(#edge)"/>
  <path d="M512 744 C 410 650, 210 636, 30 690 L 30 806 C 210 760, 410 768, 512 852 Z" fill="url(#page-l)"/>
  <path d="M512 744 C 614 650, 814 636, 994 690 L 994 806 C 814 760, 614 768, 512 852 Z" fill="url(#page-r)"/>
  <path d="M470 722 C 380 668, 230 660, 90 694 M470 752 C 380 700, 230 692, 90 726 M554 722 C 644 668, 794 660, 934 694 M554 752 C 644 700, 794 692, 934 726" fill="none" stroke="#e7c27a" stroke-opacity="0.55" stroke-width="4" stroke-linecap="round"/>
  <path d="M512 744 L 512 852" stroke="#dcaa55" stroke-width="5" stroke-linecap="round"/>
`;

const SQ = squircle(100, 100, 824, 824, 185.4);
// the art scaled into Apple's shape
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><clipPath id="sq"><path d="${SQ}"/></clipPath></defs>
  <g clip-path="url(#sq)"><g transform="translate(100 100) scale(${f(824 / 1024)})">${art}</g></g>
</svg>
`;
// the art filling the square: browsers and phones round it themselves
const full = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${art}</svg>
`;
writeFileSync(new URL("./icon.svg", import.meta.url), icon);
writeFileSync(new URL("./icon-full.svg", import.meta.url), full);
// scripts/design.mjs (macOS) reads icon-small.svg for its 16 and 32 px sizes: the same art reads there too
writeFileSync(new URL("./icon-small.svg", import.meta.url), icon);
