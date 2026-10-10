/**
 * The landing page (landing/): a static site with nothing to build, so these
 * read its files as written. What they hold it to:
 *
 *   - every sentence is there in both languages, side by side, since the page
 *     shows one at a time and a missing half is a blank for half the visitors;
 *   - every link on it goes somewhere: a file, an anchor, or a rule in
 *     `_redirects` (the one file that names the app's address);
 *   - it loads nothing from anywhere else, and has nothing inline that its
 *     own Content-Security-Policy would block;
 *   - "BJT" never names the product (a registered trademark; prose may say it).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.join(import.meta.dirname, "..", "landing");
const PUBLIC = path.join(ROOT, "public");
const PAGES = ["index.html", "404.html"];

const read = (name: string): string => readFileSync(path.join(PUBLIC, name), "utf8");

/** The sources `_redirects` answers for, e.g. `/app`. */
function redirectSources(): string[] {
  return read("_redirects")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => line.split(/\s+/)[0]);
}

/** Every `href` and `src` value on a page. */
function references(html: string): string[] {
  return [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
}

describe.each(PAGES)("%s", (page) => {
  const html = read(page);

  test("every sentence has a Japanese and an English half, in that order", () => {
    const LANG_SPAN = /<span lang="(ja|en)">((?:[^<]|<br>)*)<\/span>/g;
    const langs = [...html.matchAll(LANG_SPAN)].map((m) => m[1]);
    expect(langs.length).toBeGreaterThan(0);
    const pairs = html.replace(/<span lang="ja">(?:[^<]|<br>)*<\/span>\s*<span lang="en">(?:[^<]|<br>)*<\/span>/g, "");
    expect(pairs, "a span[lang] left without its partner").not.toMatch(/<span lang=/);
  });

  test("every link resolves to a file, an anchor or a redirect", () => {
    const redirects = redirectSources();
    for (const ref of references(html)) {
      if (ref.startsWith("#")) {
        expect(read("index.html"), `anchor ${ref}`).toContain(`id="${ref.slice(1)}"`);
        continue;
      }
      expect(ref, "a reference to another origin").toMatch(/^\//);
      if (redirects.includes(ref)) continue;
      const file = ref === "/" ? "index.html" : ref.slice(1);
      expect(existsSync(path.join(PUBLIC, file)), `${ref} has no file`).toBe(true);
    }
  });

  test("nothing inline that the Content-Security-Policy refuses", () => {
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toMatch(/<style\b/);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/\son[a-z]+="/);
  });

  test("the product is never named BJT", () => {
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    expect(title).not.toMatch(/BJT/i);
    for (const m of html.matchAll(/<meta property="og:(?:title|site_name)" content="([^"]*)"/g)) {
      expect(m[1]).not.toMatch(/BJT/i);
    }
  });
});

describe("the site", () => {
  test("the policy allows nothing from another origin", () => {
    const csp = read("_headers").match(/Content-Security-Policy: (.*)/)?.[1] ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/https?:|\*|'unsafe-inline'/);
  });

  test("the stylesheet loads nothing from another origin", () => {
    expect(read("site.css")).not.toMatch(/url\(|@import/);
  });

  test("the app's address is written once: every redirect goes to one origin", () => {
    const targets = read("_redirects")
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"))
      .map((line) => new URL(line.trim().split(/\s+/)[1]).origin);
    expect(targets.length).toBeGreaterThan(0);
    expect(new Set(targets).size).toBe(1);
    expect(redirectSources().sort()).toEqual(["/app", "/privacy"]);
  });

  test("the Worker is files only, and its name is not BJT", () => {
    const config = readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
    const name = config.match(/"name":\s*"([^"]*)"/)?.[1] ?? "";
    expect(name).not.toMatch(/bjt/i);
    expect(config).not.toMatch(/^\s*"main"/m);
    expect(config).not.toMatch(/d1_databases|r2_buckets|kv_namespaces/);
  });
});
