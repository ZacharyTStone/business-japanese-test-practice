/**
 * The privacy policy (lib/privacy.ts): the two languages say the same
 * things, point for point, and the page never shows a blank where the
 * operator or the contact address belongs.
 */
import { describe, expect, it } from "vitest";

import { PRIVACY_CONTACT, PRIVACY_OPERATOR, PRIVACY_UPDATED, privacyFooter, privacySections } from "./privacy";

describe("the privacy policy", () => {
  it("says the same number of things in both languages", () => {
    const ja = privacySections("ja");
    const en = privacySections("en");
    expect(ja.length).toBe(en.length);
    ja.forEach((section, i) => expect(section.paragraphs.length, section.title).toBe(en[i].paragraphs.length));
    for (const s of [...ja, ...en]) {
      expect(s.title.trim()).not.toBe("");
      for (const p of s.paragraphs) expect(p.trim()).not.toBe("");
    }
  });

  it("dates itself, and says so when the operator or the contact is not filled in yet", () => {
    expect(PRIVACY_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const lang of ["ja", "en"] as const) {
      const footer = privacyFooter(lang).join("\n");
      expect(footer).toContain(PRIVACY_UPDATED);
      if (!PRIVACY_OPERATOR || !PRIVACY_CONTACT) expect(footer).toMatch(/準備中|to be added/);
    }
  });

  it("tells a reader where to delete their account", () => {
    expect(privacySections("ja").some((s) => s.paragraphs.some((p) => p.includes("アカウントを削除")))).toBe(true);
    expect(privacySections("en").some((s) => s.paragraphs.some((p) => p.includes("Delete account")))).toBe(true);
  });
});
