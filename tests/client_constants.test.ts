/**
 * The app's copy of the pipeline's constants is the one the generator writes.
 *
 * `client/src/lib/generated.ts` is written by `node bjt/client_constants.ts`
 * from the distractor-role enums and the seed tables. A role or a tag added on
 * the pipeline side and not regenerated would reach the app as a generic
 * sentence such as 「この場面に合わない」 or a raw id, so a stale file fails here.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as clientConstants from "../bjt/client_constants.ts";
import { DISTRACTOR_ROLES } from "../bjt/fidelity/roles.ts";
import { toFloat } from "../bjt/py.ts";
import { tmpPath } from "./helpers.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("client_constants", () => {
  test("the committed file is what the generator writes", () => {
    expect(
      readFileSync(clientConstants.TARGET, "utf8") === clientConstants.render(),
      "client/src/lib/generated.ts is stale: run node bjt/client_constants.ts",
    ).toBe(true);
  });

  test("every role of every type is in it once", () => {
    const roles = clientConstants.distractorRoles();
    expect(roles.length).toBe(new Set(roles).size);
    expect(new Set(roles)).toEqual(new Set(Object.values(DISTRACTOR_ROLES).flat()));
  });

  test("a tag label is the one most tables agree on", () => {
    const tmp = tmpPath();
    for (const [name, label] of [["a", "依頼する"], ["b", "依頼する"], ["c", "お願いする"]]) {
      writeFileSync(
        path.join(tmp, `${name}.json`),
        `{"functions": [{"id": "request", "ja": "${label}"}]}`, "utf8");
    }
    expect(clientConstants.tagLabels({ seedtableDir: tmp })["function"]["request"]).toBe("依頼する");
  });

  /** roles.ts types its table as a Record over the generated roles, so the
   *  typecheck is what enforces coverage. This only checks that it still does:
   *  a table typed as a plain Record<string, …> would let a role slip through. */
  test("the app describes every role by the generated list", () => {
    const rolesTs = readFileSync(path.join(ROOT, "client", "src", "lib", "roles.ts"), "utf8");
    expect(/Record<\s*DistractorRole\b/.test(rolesTs), "roles.ts no longer types its table over DistractorRole").toBe(true);
  });

  /** pace.ts clamps a reading question's clock at MAX_SCALE times its type's
   *  budget; the ladder (client/worker/core/grade.ts) calls a right answer slow
   *  past PACE_MAX_SCALE times the same budget. If the two drift, an answer
   *  given inside the clock could be held as slow. */
  test("the reading clock and the ladder agree on its longest allowance", () => {
    const pace = readFileSync(path.join(ROOT, "client", "src", "lib", "pace.ts"), "utf8");
    const ts = /const MAX_SCALE = ([0-9.]+);/.exec(pace);
    expect(ts, "pace.ts no longer declares MAX_SCALE as expected").toBeTruthy();
    const grade = readFileSync(path.join(ROOT, "client", "worker", "core", "grade.ts"), "utf8");
    const ladder = /export const PACE_MAX_SCALE = ([0-9.]+);/.exec(grade);
    expect(ladder, "grade.ts no longer declares PACE_MAX_SCALE as expected").toBeTruthy();
    expect(toFloat(ladder![1])).toBe(toFloat(ts![1]));
  });
});
