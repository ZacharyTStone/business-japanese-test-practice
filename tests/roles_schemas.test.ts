/**
 * Distractor-role enforcement and item validation (fidelity mechanism #1).
 */
import { describe, expect, test } from "vitest";
import * as fixtures from "../bjt/fixtures.ts";
import { has, sorted } from "../bjt/py.ts";
import * as schemas from "../bjt/schemas.ts";
import * as seedtable from "../bjt/seedtable.ts";
import * as roles from "../bjt/fidelity/roles.ts";
import { GENERATORS } from "../bjt/generators/index.ts";
import { goiItem, hyougenItem } from "./conftest.ts";

describe("roles and schemas", () => {
  test("fixtures validate clean", () => {
    expect(schemas.validateItem("goi_bunpou", goiItem())).toEqual([]);
    expect(schemas.validateItem("hyougen", hyougenItem())).toEqual([]);
  });

  test("reject duplicate role", () => {
    const opts = [
      { "text": "a", "role": "correct" },
      { "text": "b", "role": "opposite_valence" },
      { "text": "c", "role": "opposite_valence" },
      { "text": "d", "role": "nonexistent_form" },
    ];
    const errs = roles.validateRoles("goi_bunpou", opts);
    expect(errs.some((e) => e.includes("duplicate"))).toBe(true);
  });

  test("reject role outside enum", () => {
    const opts = [
      { "text": "a", "role": "correct" },
      { "text": "b", "role": "wrong_honorific_direction" },  // a hyougen role, not goi
      { "text": "c", "role": "nonexistent_form" },
      { "text": "d", "role": "set_phrase_misfit" },
    ];
    const errs = roles.validateRoles("goi_bunpou", opts);
    expect(errs.some((e) => e.includes("not in the goi_bunpou enum"))).toBe(true);
  });

  test("reject missing correct", () => {
    const opts = [..."abcd"].map((t) => ({ "text": t, "role": "opposite_valence" }));
    const errs = roles.validateRoles("goi_bunpou", opts);
    expect(errs.some((e) => e.includes("exactly 1 correct"))).toBe(true);
  });

  test("reject two correct", () => {
    const opts = [
      { "text": "a", "role": "correct" },
      { "text": "b", "role": "correct" },
      { "text": "c", "role": "nonexistent_form" },
      { "text": "d", "role": "set_phrase_misfit" },
    ];
    const errs = roles.validateRoles("goi_bunpou", opts);
    expect(errs.some((e) => e.includes("exactly 1 correct"))).toBe(true);
  });

  test("reject wrong option count", () => {
    const opts = [
      { "text": "a", "role": "correct" },
      { "text": "b", "role": "opposite_valence" },
      { "text": "c", "role": "nonexistent_form" },
    ];
    const errs = roles.validateRoles("goi_bunpou", opts);
    expect(errs.some((e) => e.includes("expected 4 options"))).toBe(true);
  });

  test("reject duplicate option text", () => {
    const item = goiItem();
    item["options"][1]["text"] = item["options"][0]["text"];
    const errs = schemas.validateItem("goi_bunpou", item);
    expect(errs.some((e) => e.includes("duplicate text"))).toBe(true);
  });

  test("correct index matches role", () => {
    const item = goiItem();
    const ci = schemas.correctIndex(item["options"]);
    expect(item["options"][ci]["role"]).toBe(roles.CORRECT);
  });

  test("schema constrains role enum", () => {
    const schema = schemas.buildItemSchema("hyougen");
    const roleEnum = schema["properties"]["options"]["items"]["properties"]["role"]["enum"];
    expect(roleEnum).toContain("correct");
    expect(roleEnum).toContain("wrong_honorific_direction");
    expect(roleEnum).not.toContain("opposite_valence");  // that's a goi role
  });

  test("every item type has role descriptions", () => {
    for (const roleList of Object.values(roles.DISTRACTOR_ROLES)) {
      for (const r of roleList) {
        expect(has(roles.ROLE_DESCRIPTIONS, r), `${r} missing a description`).toBe(true);
      }
    }
  });

  // ----- every type is real, not merely declared ----------------------------

  test.each(sorted(Object.keys(GENERATORS)))("every item type has a valid fixture %s", (itemType) => {
    // A schema nothing ever constructs is a schema that is only asserted. The
    // fixtures are the thing that proves each of the nine types can actually be
    // filled in — with no API key, before a paid batch run finds out.
    expect(has(fixtures.FIXTURES, itemType), `${itemType} has no fixture`).toBe(true);
    expect(schemas.validateItem(itemType, fixtures.FIXTURES[itemType])).toEqual([]);
  });

  test.each(sorted(Object.keys(GENERATORS)))("every item type has a seed table %s", (itemType) => {
    // Variety comes from the table. A type without one can only get its
    // variety from the prompt, which is the thing the table exists to replace.
    const table = seedtable.load(itemType);
    expect(table.cells().length > 0, `${itemType}'s seed table enumerates no valid cells`).toBe(true);
    for (const level of ["J3", "J2", "J1"]) {
      expect(table.cells({ level }).length > 0, `${itemType} has no cells at ${level}`).toBe(true);
    }
  });

  test.each(sorted(Object.keys(GENERATORS)))("every item type has distinct distractor roles %s", (itemType) => {
    // Three distractors need three distinct roles, so an enum of fewer than
    // three cannot produce a valid item at all.
    expect(roles.DISTRACTOR_ROLES[itemType].length).toBeGreaterThanOrEqual(3);
    for (const role of roles.DISTRACTOR_ROLES[itemType]) {
      expect(has(roles.ROLE_DESCRIPTIONS, role), `${role} has no description`).toBe(true);
    }
  });

  test("the chart fixture is a valid item", () => {
    // The one fixture whose 資料 is a graph — proof that a chart can actually
    // be filled in, before a paid batch run finds out.
    expect(schemas.validateItem("shiryou_choudokkai", fixtures.CHART_FIXTURE)).toEqual([]);
  });
});
