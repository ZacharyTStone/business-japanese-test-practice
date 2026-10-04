/**
 * The bearer has to reach the request a picture makes. On Android, React
 * Native's Image forwards `headers` to the native view only from an array
 * source (Libraries/Image/Image.android.js); from a single object it drops
 * them, and the Worker refuses the picture. The first Android build showed no
 * pictures while every clip played, which is how this was found.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { pictureSourceFor } from "./phoneSession";

const URL_ = "https://app.example/media/scenes/office.webp";
const BEARER = { Authorization: "Bearer signed.token" };

describe("a picture's source", () => {
  it("is a one-element array carrying the bearer on a phone", () => {
    expect(pictureSourceFor(URL_, BEARER)).toEqual([{ uri: URL_, headers: BEARER }]);
  });

  it("is a plain address on the web, where the cookie rides along", () => {
    expect(pictureSourceFor(URL_, null)).toEqual({ uri: URL_ });
  });

  it("relies on Image.android.js forwarding headers from an array source", () => {
    // If React Native changes how Android's Image reads headers, check on a
    // phone that pictures still load before changing this test.
    const client = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
    const source = readFileSync(path.join(client, "node_modules/react-native/Libraries/Image/Image.android.js"), "utf8");
    const arrayBranch = /if \(Array\.isArray\(source_\)\) \{([\s\S]*?)\} else \{/.exec(source);
    expect(arrayBranch, "Image.android.js no longer has the array-source branch").toBeTruthy();
    expect(arrayBranch![1]).toContain("nativeProps.headers = sourceHeaders");
  });
});
