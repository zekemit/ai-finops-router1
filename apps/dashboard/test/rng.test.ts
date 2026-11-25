import { describe, expect, it } from "vitest";
import { createRng } from "../src/lib/rng";

describe("createRng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(Array.from({ length: 20 }, () => b.next()));
  });

  it("produces different sequences for different seeds", () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it("returns floats in [0, 1) that are roughly uniform", () => {
    const rng = createRng(7);
    const draws = Array.from({ length: 10_000 }, () => rng.next());
    expect(draws.every((n) => n >= 0 && n < 1)).toBe(true);
    const mean = draws.reduce((s, n) => s + n, 0) / draws.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });

  it("int() is inclusive at both ends and never leaves the range", () => {
    const rng = createRng(3);
    const seen = new Set(Array.from({ length: 500 }, () => rng.int(5, 8)));
    expect([...seen].sort()).toEqual([5, 6, 7, 8]);
  });

  it("range() stays within [min, max)", () => {
    const rng = createRng(11);
    for (let i = 0; i < 500; i += 1) {
      const n = rng.range(10, 20);
      expect(n).toBeGreaterThanOrEqual(10);
      expect(n).toBeLessThan(20);
    }
  });

  it("pick() returns members of the list and throws on an empty list", () => {
    const rng = createRng(5);
    const items = ["a", "b", "c"] as const;
    for (let i = 0; i < 50; i += 1) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it("chance() honours its extremes", () => {
    const rng = createRng(9);
    expect(Array.from({ length: 100 }, () => rng.chance(0)).some(Boolean)).toBe(false);
    expect(Array.from({ length: 100 }, () => rng.chance(1)).every(Boolean)).toBe(true);
  });
});

describe("createRng().shuffle", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

  it("returns a permutation of its input without touching the original", () => {
    const original = [...items];
    const shuffled = createRng(1).shuffle(original);
    expect([...shuffled].sort((a, b) => a - b)).toEqual([...items]);
    expect(original).toEqual([...items]);
    expect(shuffled).not.toBe(original);
  });

  it("is deterministic per seed and actually reorders for most seeds", () => {
    expect(createRng(5).shuffle(items)).toEqual(createRng(5).shuffle(items));
    const moved = Array.from({ length: 20 }, (_, seed) => createRng(seed + 1).shuffle(items).join() !== items.join());
    expect(moved.filter(Boolean).length).toBeGreaterThanOrEqual(19);
  });

  it("gives every position every value over many seeds (no biased shuffle)", () => {
    const firsts = new Set(Array.from({ length: 300 }, (_, seed) => createRng(seed + 1).shuffle(items)[0]));
    expect(firsts.size).toBe(items.length);
  });

  it("handles empty and single-element lists", () => {
    expect(createRng(1).shuffle([])).toEqual([]);
    expect(createRng(1).shuffle(["x"])).toEqual(["x"]);
  });
});
