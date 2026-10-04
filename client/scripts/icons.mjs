/**
 * The app's icon, drawn once and rendered to every size Android, the web and
 * Google Play ask for: a speech bubble (business Japanese is spoken) with a
 * tick in it (a drill), white on the app's accent.
 *
 * The geometry below is the source; the PNGs are committed, so this runs only
 * when the drawing changes:
 *
 *   node scripts/icons.mjs        (in client/)
 *
 * It renders with sharp, which wrangler's local runtime already installs.
 *
 *   assets/icon.png                     1024, full bleed, no alpha (the legacy icon)
 *   assets/android-icon-foreground.png  1024, the bubble inside the adaptive icon's safe circle
 *   assets/android-icon-monochrome.png  1024, the same shape as one alpha mask (themed icons)
 *   assets/favicon.png                  48, rounded
 *   store/icon-512.png                  512, full bleed (Play rounds it itself)
 *   store/feature-graphic.png           1024 x 500, no alpha
 *
 * The adaptive icon's background is `android.adaptiveIcon.backgroundColor` in
 * app.json, which must stay `ACCENT`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** theme.ts's accent and its deeper shade. */
const ACCENT = "#6C5CE7";
const ACCENT_DEEP = "#4B3BD4";
const WHITE = "#FFFFFF";

/*
 * The bubble, centred on (0, 0) at scale 1: a rounded body, a curved tail at
 * its lower left, and a tick centred in the body. The whole thing is 560 wide
 * and 540 tall; its farthest point from the centre is the tail's tip, 368 out,
 * which is what the adaptive icon's scale is chosen against.
 */
const BODY = { x: -280, y: -270, w: 560, h: 440, r: 120 };
const TAIL = "M -190 130 Q -190 230 -250 270 Q -120 260 -60 170 Z";
const TICK = "M -124 -56 L -38 30 L 124 -132";
const TICK_WIDTH = 66;

/** The bubble at `scale`, centred on (cx, cy), the tick in `tickColour` (or cut out). */
function bubble(cx, cy, scale, { fill, tickColour, cutTick = false, id = "b" }) {
  const t = `translate(${cx} ${cy}) scale(${scale})`;
  const tick = `<path d="${TICK}" fill="none" stroke-width="${TICK_WIDTH}" stroke-linecap="round" stroke-linejoin="round"`;
  const shape = `<rect x="${BODY.x}" y="${BODY.y}" width="${BODY.w}" height="${BODY.h}" rx="${BODY.r}"/><path d="${TAIL}"/>`;
  if (cutTick) {
    return `<mask id="${id}" maskUnits="userSpaceOnUse" x="-400" y="-400" width="800" height="800">
        <g fill="${WHITE}">${shape}</g>${tick} stroke="#000"/>
      </mask>
      <g transform="${t}"><g fill="${fill}" mask="url(#${id})">${shape}</g></g>`;
  }
  return `<g transform="${t}"><g fill="${fill}">${shape}</g>${tick} stroke="${tickColour}"/></g>`;
}

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

/** The square icon: accent ground, the bubble at 55% of the width. */
const square = (size, radius = 0) => {
  const s = size / 1024;
  return svg(
    size,
    size,
    `<rect width="${size}" height="${size}" rx="${radius}" fill="${ACCENT}"/>` +
      bubble(size / 2, size / 2, s, { fill: WHITE, tickColour: ACCENT }),
  );
};

/*
 * The adaptive icon's layers are 108 dp, of which a launcher shows at least
 * the central 66 dp circle (radius 313 of 1024). At 0.7 the tail's tip is
 * 258 out, so even a circular mask leaves a margin round the bubble.
 */
const ADAPTIVE_SCALE = 0.7;

const foreground = svg(1024, 1024, bubble(512, 512, ADAPTIVE_SCALE, { fill: WHITE, tickColour: ACCENT }));
const monochrome = svg(1024, 1024, bubble(512, 512, ADAPTIVE_SCALE, { fill: WHITE, cutTick: true, id: "mono" }));

/*
 * The feature graphic: the bubble on the left, and on the right the four
 * answers every question offers, the second one chosen. No words: Play shows
 * the name beside it, and the graphic is cropped on some screens, so what
 * matters sits in the middle.
 */
const featureGraphic = (() => {
  const W = 1024;
  const H = 500;
  const rows = [0, 1, 2, 3]
    .map((i) => {
      const y = 112 + i * 76;
      const chosen = i === 1;
      const badge = `<circle cx="566" cy="${y + 26}" r="17" fill="${chosen ? ACCENT : "none"}" stroke="${chosen ? ACCENT : WHITE}" stroke-width="5"/>`;
      return (
        `<rect x="530" y="${y}" width="360" height="52" rx="26" fill="${WHITE}" fill-opacity="${chosen ? 1 : 0.22}"/>` +
        badge +
        `<rect x="602" y="${y + 20}" width="${[200, 236, 172, 214][i]}" height="12" rx="6" fill="${chosen ? ACCENT : WHITE}" fill-opacity="${chosen ? 0.35 : 0.5}"/>`
      );
    })
    .join("");
  return svg(
    W,
    H,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${ACCENT}"/><stop offset="1" stop-color="${ACCENT_DEEP}"/>
      </linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/>` +
      bubble(300, 250, 0.58, { fill: WHITE, tickColour: ACCENT }) +
      rows,
  );
})();

async function render(file, source, { alpha = true } = {}) {
  let image = sharp(Buffer.from(source));
  if (!alpha) image = image.flatten({ background: ACCENT }).removeAlpha();
  const out = join(ROOT, file);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, await image.png({ compressionLevel: 9 }).toBuffer());
  console.log(file);
}

await render("assets/icon.png", square(1024), { alpha: false });
await render("assets/android-icon-foreground.png", foreground);
await render("assets/android-icon-monochrome.png", monochrome);
await render("assets/favicon.png", square(48, 10));
await render("store/icon-512.png", square(512), { alpha: false });
await render("store/feature-graphic.png", featureGraphic, { alpha: false });
