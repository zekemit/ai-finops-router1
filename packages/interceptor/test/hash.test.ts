import { describe, expect, it } from "vitest";
import { fnv1a, stableStringify } from "../src/hash";

describe("fnv1a", () => {
  it("matches the published FNV-1a 32-bit test vectors", () => {
    expect(fnv1a("")).toBe("811c9dc5");
    expect(fnv1a("a")).toBe("e40c292c");
    expect(fnv1a("foobar")).toBe("bf9cf968");
  });

  it("is deterministic and sensitive to input", () => {
    expect(fnv1a("npm test")).toBe(fnv1a("npm test"));
    expect(fnv1a("npm test")).not.toBe(fnv1a("npm  test"));
  });
});

describe("stableStringify", () => {
  it("ignores object key order so equal inputs fingerprint identically", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("preserves array order", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("serialises primitives and null like JSON", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify("x")).toBe('"x"');
    expect(stableStringify(5)).toBe("5");
  });
});
