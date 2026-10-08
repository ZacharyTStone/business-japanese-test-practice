/**
 * Fidelity mechanism #5 — vocabulary gating.
 *
 * Constrain generation to a target vocabulary band using JLPT kanji tiers for level
 * control, plus a business-vocabulary list (the 重要ビジネス用語表現集 booklet the
 * user supplies in seeds/).
 *
 * Kanji tier lists and the business list are authoritative/licensed data, so they
 * live in seeds/vocab/ — the gate only enforces what the user has actually loaded:
 *
 *   * A kanji ceiling is enforced for a level ONLY when every tier up to that
 *     level's ceiling is present. Then any kanji outside the allowed band is a
 *     violation. If the ceiling tier is missing we cannot prove a violation, so the
 *     gate is permissive and says so in the quality report. (This makes the gate
 *     strict at lower levels — where the allowed set is small and well defined —
 *     and permissive at J1, which allows almost all kanji anyway.)
 *   * Business-term coverage is reported as an informational metric, not a hard
 *     gate: without a morphological tokenizer we can't reliably segment words, so
 *     we report simple membership rather than reject on it.
 *
 * File format for seeds/vocab/jlpt_n5_kanji.txt (and n4/n3/n2/n1): kanji separated
 * by whitespace or newlines; anything non-kanji is ignored. Business terms:
 * seeds/vocab/business_terms.txt, one term per line.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as config from "../config.ts";
import { get, has, repr, sorted, splitlines, strip } from "../py.ts";
import * as textutil from "../textutil.ts";

export const TIER_ORDER = ["N5", "N4", "N3", "N2", "N1"];
export const LEVEL_CEILING: Record<string, string> = { J3: "N3", J2: "N2", J1: "N1" };

export function _loadTier(tier: string): Set<string> {
  const p = path.join(config.SEEDS_DIR, "vocab", `jlpt_${tier.toLowerCase()}_kanji.txt`);
  if (!existsSync(p)) {
    return new Set();
  }
  const text = readFileSync(p, "utf8");
  return textutil.kanjiIn(text);
}

export function _loadBusinessTerms(): string[] {
  const p = path.join(config.SEEDS_DIR, "vocab", "business_terms.txt");
  if (!existsSync(p)) {
    return [];
  }
  return splitlines(readFileSync(p, "utf8")).map((ln) => strip(ln)).filter((ln) => ln);
}

export class VocabResult {
  enforced: boolean;
  violations: string[];   // above-band kanji
  business_terms_used: string[];
  note: string;

  constructor(init: { enforced: boolean; violations?: string[]; business_terms_used?: string[]; note?: string }) {
    this.enforced = init.enforced;
    this.violations = init.violations ?? [];
    this.business_terms_used = init.business_terms_used ?? [];
    this.note = init.note ?? "";
  }

  get ok(): boolean {
    return this.violations.length === 0;
  }
}

export function checkItem(item: Record<string, any>, level: string): VocabResult {
  const ceiling = has(LEVEL_CEILING, level) ? LEVEL_CEILING[level] : null;
  if (ceiling === null) {
    return new VocabResult({ enforced: false, note: `unknown level ${repr(level)}` });
  }

  const ceilingIdx = TIER_ORDER.indexOf(ceiling);
  const tiers = new Map<string, Set<string>>(TIER_ORDER.slice(0, ceilingIdx + 1).map((t) => [t, _loadTier(t)]));
  // Enforce only if every tier up to the ceiling is actually loaded.
  const missing = [...tiers].filter(([, s]) => s.size === 0).map(([t]) => t);
  const business = _loadBusinessTerms();

  const textForBusiness = get(item, "stem", "")
    + (get(item, "options", []) as Record<string, any>[]).map((o) => o["text"]).join(" ");
  const termsUsed = business.filter((t) => t && textForBusiness.includes(t));

  if (missing.length) {
    return new VocabResult({
      enforced: false,
      business_terms_used: termsUsed,
      note: (
        `kanji ceiling not enforced for ${level}: missing tier data `
        + `(${missing.join(", ")}). Add seeds/vocab/jlpt_*.txt to enable.`
      ),
    });
  }

  const allowed = new Set<string>();
  for (const s of tiers.values()) for (const k of s) allowed.add(k);
  const violations = sorted([...textutil.itemKanji(item)].filter((k) => !allowed.has(k)));
  return new VocabResult({
    enforced: true,
    violations: violations,
    business_terms_used: termsUsed,
    note: `kanji ceiling ${ceiling} enforced`,
  });
}

/** For the quality report: which vocab data is loaded. */
export function statusSummary(): { tiers_loaded: string[]; business_terms: number } {
  return {
    tiers_loaded: TIER_ORDER.filter((t) => _loadTier(t).size > 0),
    business_terms: _loadBusinessTerms().length,
  };
}
