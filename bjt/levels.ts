/**
 * Target level (J3/J2/J1) described with CAN-DO style descriptors.
 *
 * The brief is explicit: describe difficulty with the official CAN-DO descriptors
 * from the BJT level guide, not invented difficulty language. The authoritative
 * text is copyrighted, so it belongs in seeds/ — drop the exact wording into
 * seeds/levels.json and it overrides the neutral built-in defaults below.
 *
 * The defaults are deliberately plain and non-authoritative: enough to steer the
 * generator toward the right band, phrased so nothing is claimed as official text.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import * as config from "./config.ts";
import { unreadable } from "./files.ts";
import { has, PyError, repr, ValueError } from "./py.ts";

export const LEVELS = ["J3", "J2", "J1"];

// Neutral fallbacks. Overridden by seeds/levels.json when present.
export const _DEFAULT_DESCRIPTORS: Record<string, string> = {
  "J3": (
    "Has a basic command of business Japanese sufficient to handle routine, " +
    "predictable workplace communication. Understands straightforward notices, " +
    "short instructions, and common set phrases; keigo is simple and formulaic."
  ),
  "J2": (
    "Has a practical command of business Japanese for a wide range of ordinary " +
    "workplace situations. Handles less predictable exchanges, longer documents, " +
    "and keigo choices that depend on relative status and in-group/out-group."
  ),
  "J1": (
    "Has a broad command of business Japanese close to that expected of a " +
    "native professional. Handles nuanced, indirect, and non-standard usage, " +
    "subtle register distinctions, and specialised or abstract business content."
  ),
};

export function _loadFromSeeds(): Record<string, string> {
  const file = path.join(config.SEEDS_DIR, "levels.json");
  if (!existsSync(file)) {
    return {};
  }
  let data: any;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    // The file is there but cannot be read.
    if (unreadable(e)) {
      return {};
    }
    throw e;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new PyError(`'${Array.isArray(data) ? "list" : typeof data}' object has no attribute 'items'`);
  }
  // Accept {"J2": "text", ...} or {"J2": {"descriptor": "text"}}.
  const out: Record<string, string> = {};
  for (const [lvl, val] of Object.entries(data)) {
    if (typeof val === "string") {
      out[lvl] = val;
    } else if (val !== null && typeof val === "object" && !Array.isArray(val) && has(val, "descriptor")) {
      out[lvl] = (val as any)["descriptor"];
    }
  }
  return out;
}

export function descriptor(level: string): string {
  if (!LEVELS.includes(level)) {
    throw new ValueError(`unknown level ${repr(level)}; expected one of ${repr(LEVELS)}`);
  }
  const seeds = _loadFromSeeds();
  return has(seeds, level) ? seeds[level] : _DEFAULT_DESCRIPTORS[level];
}

/** True when the authoritative descriptors have been supplied via seeds. */
export function usingOfficialDescriptors(): boolean {
  return Object.keys(_loadFromSeeds()).length > 0;
}
