import { describe, expect, it } from "vitest";

import { cacheControl, contentTypeFor, parseMediaPath } from "./media";

describe("a /media/ path", () => {
  it("names a bucket and the path the database holds", () => {
    expect(parseMediaPath("/media/audio/openai/ab/ab12cd.wav")).toEqual({
      bucket: "audio",
      path: "openai/ab/ab12cd.wav",
      key: "audio/openai/ab/ab12cd.wav",
    });
    expect(parseMediaPath("/media/scenes/pic_09fa4bde9a.webp")?.key).toBe("scenes/pic_09fa4bde9a.webp");
  });

  it("names nothing outside the two buckets, or above them", () => {
    expect(parseMediaPath("/media/private/x.wav")).toBeNull();
    expect(parseMediaPath("/media/audio")).toBeNull();
    expect(parseMediaPath("/media/audio/../scenes/x.webp")).toBeNull();
    expect(parseMediaPath("/media/audio/%2e%2e/x.wav")).toBeNull();
    expect(parseMediaPath("/media/audio/a%2Fb.wav")).toBeNull();
    expect(parseMediaPath("/media/audio/.hidden")).toBeNull();
    expect(parseMediaPath("/media/audio/%E0%A4%A.wav")).toBeNull();
  });

  it("keeps a clip forever and a picture for a day", () => {
    expect(cacheControl("audio")).toContain("immutable");
    expect(cacheControl("scenes")).toBe("private, max-age=86400");
  });

  it("lets no shared cache keep what only a signed-in person may fetch", () => {
    for (const bucket of ["audio", "scenes"]) {
      expect(cacheControl(bucket)).toMatch(/^private,/);
      expect(cacheControl(bucket)).not.toContain("public");
    }
  });

  it("knows the types the pipeline writes", () => {
    expect(contentTypeFor("a/b.wav")).toBe("audio/wav");
    expect(contentTypeFor("x.webp")).toBe("image/webp");
    expect(contentTypeFor("x.unknown")).toBe("application/octet-stream");
  });
});
