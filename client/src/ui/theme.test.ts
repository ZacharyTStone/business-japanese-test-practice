/**
 * The app's colour tokens, held to a contrast ratio a person can read.
 *
 * The hero on 今日 and on the result screen puts three lines on a violet fill:
 * the countdown, the headline, and the streak. Two of those are 13px, which
 * needs 4.5:1. A colour too faint for that is easy to miss in review, because
 * it looks deliberate: it is called `onAccentMuted`, and muted is what it is
 * for.
 *
 * So the arithmetic is a check rather than a note in a review. It reads the
 * tokens out of `theme.ts` as text — the same file the app imports, so a value
 * that drifts drifts here too — and asserts the pairings the app actually
 * draws.
 *
 * What this cannot see is *which* fill a screen chooses: that rule ("an accent
 * fill that carries text is `accentDeep` or darker") is stated at the top of
 * theme.ts and kept by a reader. What it can see is that the fills declared for
 * text, and the text colours declared for them, are legible together —
 * including `badge`, whose tint is 13px text in a `Tag` as well as an icon in
 * an `IconBadge`, and so is held to the text bar rather than the graphic one.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const UI = path.dirname(new URL(import.meta.url).pathname);
const CLIENT = path.resolve(UI, "..", "..");
const THEME = path.join(UI, "theme.ts");

/** WCAG 2.1 AA. 4.5:1 for body text; 3:1 for text at 24px, or 18.66px bold,
 *  and for a graphic that carries meaning — a control's edge, a bar that runs
 *  out. */
const AA_SMALL_TEXT = 4.5;
const AA_GRAPHIC = 3.0;

/** The `colors` object, as a name → #RRGGBB map. */
function tokens(): Record<string, string> {
  const source = readFileSync(THEME, "utf8");
  const body = /export const colors = \{([\s\S]*?)\n\} as const;/.exec(source);
  expect(body, "theme.ts no longer exports a `colors` object shaped as expected").toBeTruthy();
  const out: Record<string, string> = {};
  for (const m of body![1].matchAll(/^\s{2}(\w+):\s*"(#[0-9A-Fa-f]{6})"/gm)) out[m[1]] = m[2].toUpperCase();
  return out;
}

/** The `badge` object, as tone → [fg, bg]. */
function badges(): Record<string, [string, string]> {
  const source = readFileSync(THEME, "utf8");
  const body = /export const badge = \{([\s\S]*?)\n\} as const;/.exec(source);
  expect(body, "theme.ts no longer exports a `badge` object shaped as expected").toBeTruthy();
  const tones: Record<string, [string, string]> = {};
  const re = /^\s{2}(\w+):\s*\{\s*fg:\s*"(#[0-9A-Fa-f]{6})",\s*bg:\s*"(#[0-9A-Fa-f]{6})"\s*\}/gm;
  for (const m of body![1].matchAll(re)) tones[m[1]] = [m[2].toUpperCase(), m[3].toUpperCase()];
  expect(Object.keys(tones).length, `expected five badge tones, found ${Object.keys(tones).sort()}`).toBe(5);
  return tones;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG 2.1 contrast ratio, 1:1 to 21:1. */
function contrast(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const ratio = (r: number) => r.toFixed(2);

/** Every .tsx file of the app, outside node_modules, in name order. */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** The conditions that describe a lasting state rather than a finger on the
 *  screen. `pressed` and `hovered` are not here on purpose: they last as long
 *  as the touch does, and a momentary dip is what direct manipulation looks
 *  like everywhere. */
const STATE_TESTS = ["disabled &&", "disabled ?", "dim &&", "dim ?"];

describe("theme contrast", () => {
  test("the maths is the maths", () => {
    // Two ends of the scale, so a broken formula fails here and not in the UI.
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21.0, 6);
    expect(Math.abs(contrast("#777777", "#FFFFFF") - 4.48)).toBeLessThanOrEqual(0.01);
  });

  // Every text colour the app puts on an accent fill, against both ends of the
  // hero's gradient. `accentDeep` is the light end — the corner the countdown
  // sits in — so it is the one that decides.
  for (const fill of ["accentDeep", "accentInk"]) {
    for (const text of ["onAccent", "onAccentMuted"]) {
      test(`text on an accent fill is readable: ${text} on ${fill}`, () => {
        const c = tokens();
        const r = contrast(c[text], c[fill]);
        expect(r, `${text} (${c[text]}) on ${fill} (${c[fill]}) is ${ratio(r)}:1, under the ${AA_SMALL_TEXT}:1 that 13px text needs`).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      });
    }
  }

  test("the hero card carries its own fill", () => {
    // The contrast above is only true if the violet is actually there. The hero
    // draws a gradient over itself with an SVG paint server; a browser that
    // declines to paint it would leave the text on the page's near-white. So
    // the fill is a property of the card, and the check is that it is one of
    // the fills the test above approves rather than any violet at all.
    const source = readFileSync(path.join(UI, "components.tsx"), "utf8");
    const card = /gradientCard:\s*\{([\s\S]*?)\n {2}\},/.exec(source);
    expect(card, "components.tsx no longer declares a `gradientCard` style").toBeTruthy();
    const fill = /backgroundColor:\s*colors\.(\w+)/.exec(card![1]);
    expect(fill, "the hero card has no background of its own — the gradient is not a fill").toBeTruthy();
    expect(["accentDeep", "accentInk"], `the hero card is filled with \`${fill![1]}\`; a fill that carries text is accentDeep or darker (theme.ts)`).toContain(fill![1]);
  });

  test("a state that lasts is drawn rather than dimmed", () => {
    // A control that cannot be pressed, or an option no longer in play, is
    // drawn as one: a flat fill, a grey label, no shadow. Fading it to a
    // fraction makes every colour underneath lie about its own contrast, makes
    // off and not-yet-loaded look identical, and on a half-there card leaves
    // text on nothing at all.
    const offences: string[] = [];
    for (const file of tsxFiles(CLIENT)) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (!line.includes("opacity")) return;
        if (STATE_TESTS.some((flag) => line.includes(flag))) {
          offences.push(`${path.relative(path.dirname(CLIENT), file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offences, "a lasting state is dimmed rather than drawn:\n  " + offences.join("\n  ")).toEqual([]);
  });

  test("muted is quieter than loud but still text", () => {
    // Muted has a job: it is the second line, and it has to look like one.
    // Lifting it to white would pass the check above and lose the hierarchy.
    const c = tokens();
    const loud = contrast(c.onAccent, c.accentDeep);
    const quiet = contrast(c.onAccentMuted, c.accentDeep);
    expect(quiet < loud, "onAccentMuted is no quieter than onAccent").toBe(true);
  });

  test("body text on the page is readable", () => {
    // Prose on a card, and the small grey under it.
    const c = tokens();
    for (const text of ["text", "muted"]) {
      for (const surface of ["surface", "bg", "surfaceAlt"]) {
        const r = contrast(c[text], c[surface]);
        expect(r, `${text} on ${surface} is ${ratio(r)}:1`).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      }
    }
  });

  // `correct` and `wrong` are text, not only a border: 「正解」 is drawn in
  // `correct` on a `correctSoft` card, and the review marks each option in one
  // of the two on the matching soft fill — and on plain white in the history.
  for (const fill of ["soft", "surface"]) {
    for (const [ink, soft] of [["correct", "correctSoft"], ["wrong", "wrongSoft"]]) {
      test(`the verdict is readable where it is written: ${ink} on ${fill}`, () => {
        const c = tokens();
        const background = c[fill === "soft" ? soft : "surface"];
        const r = contrast(c[ink], background);
        expect(r, `${ink} (${c[ink]}) on ${background} is ${ratio(r)}:1`).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      });
    }
  }

  test("the verdict colours are still the colours they mean", () => {
    // Darker, not different: green stays greenest in green, red reddest in red.
    const c = tokens();
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    let [r, g, b] = rgb(c.correct);
    expect(g > r && g > b, `correct (${c.correct}) is not green`).toBe(true);
    [r, g, b] = rgb(c.wrong);
    expect(r > g && r > b, `wrong (${c.wrong}) is not red`).toBe(true);
  });

  // `muted` is not only on white: the verdict card writes its second line on
  // the soft fills, and a `Tag` with no tone is `muted` on `accentSoft`.
  for (const fill of ["correctSoft", "wrongSoft", "accentSoft"]) {
    test(`the second line is readable on the soft fills: ${fill}`, () => {
      const c = tokens();
      const r = contrast(c.muted, c[fill]);
      expect(r, `muted on ${fill} is ${ratio(r)}:1`).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
  }

  // `Tag` writes 13px bold text in a badge's `fg` on its `bg`, so the pair is
  // text, not only the 3:1 graphic an `IconBadge` would need.
  for (const tone of ["violet", "teal", "pink", "amber", "blue"]) {
    test(`a tag is readable in its own tint: ${tone}`, () => {
      const [fg, bg] = badges()[tone];
      const r = contrast(fg, bg);
      expect(r, `badge ${tone} (${fg} on ${bg}) is ${ratio(r)}:1`).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
  }

  // Something you type into has a visible boundary: 3:1 against whatever it
  // sits on. `border`, the card hairline, is 1.2:1 and is not for this.
  for (const surface of ["surface", "surfaceAlt", "bg"]) {
    test(`a field has an edge: ${surface}`, () => {
      const c = tokens();
      const r = contrast(c.inputBorder, c[surface]);
      expect(r, `inputBorder on ${surface} is ${ratio(r)}:1`).toBeGreaterThanOrEqual(AA_GRAPHIC);
    });
  }

  // `warn` is a shape: the reading clock's bar on white as it runs low, and
  // the 場面ちがい meter on the red verdict card.
  for (const fill of ["surface", "wrongSoft"]) {
    test(`the warning amber is visible where it is drawn: ${fill}`, () => {
      const c = tokens();
      const r = contrast(c.warn, c[fill]);
      expect(r, `warn on ${fill} is ${ratio(r)}:1`).toBeGreaterThanOrEqual(AA_GRAPHIC);
    });
  }

  test("the one danger button is readable", () => {
    // White on `wrong`: the button that erases the record, once asked for.
    const c = tokens();
    const r = contrast(c.onAccent, c.wrong);
    expect(r, `onAccent on wrong is ${ratio(r)}:1`).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
  });

  test("a secondary button is readable", () => {
    // `accentDeep` on `accentSoft`: the label of every secondary button — back,
    // try again, the second choice on a card. `accent` there was 4.2:1.
    const c = tokens();
    const r = contrast(c.accentDeep, c.accentSoft);
    expect(r, `accentDeep on accentSoft is ${ratio(r)}:1`).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
  });
});

describe("the icon is drawn in the app's own colours", () => {
  // scripts/icons.mjs renders the PNGs; app.json fills the adaptive icon's
  // background layer, which the script cannot, so the two are held to theme.ts.
  test("the icon script and the adaptive icon's background use the accent", () => {
    const c = tokens();
    const script = readFileSync(path.join(CLIENT, "scripts", "icons.mjs"), "utf8");
    const constant = (name: string) => new RegExp(`^const ${name} = "(#[0-9A-Fa-f]{6})";`, "m").exec(script)?.[1]?.toUpperCase();
    expect(constant("ACCENT")).toBe(c.accent);
    expect(constant("ACCENT_DEEP")).toBe(c.accentDeep);
    const app = JSON.parse(readFileSync(path.join(CLIENT, "app.json"), "utf8"));
    expect(app.expo.android.adaptiveIcon.backgroundColor.toUpperCase()).toBe(c.accent);
  });
});
