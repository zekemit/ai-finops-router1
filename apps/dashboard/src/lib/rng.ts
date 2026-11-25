/** Seeded PRNG (mulberry32). The simulator must be reproducible: same seed, same sprint, byte for byte. */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max], both ends included. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
  /** Fisher-Yates over the seeded stream; returns a new array. Never shuffle with a random sort comparator: engines call it in different orders. */
  shuffle<T>(items: readonly T[]): T[];
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int,
    pick: <T,>(items: readonly T[]): T => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new RangeError("cannot pick from an empty list");
      return item;
    },
    chance: (probability) => next() < probability,
    shuffle: <T,>(items: readonly T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = int(0, i);
        const a = out[i];
        const b = out[j];
        if (a !== undefined && b !== undefined) {
          out[i] = b;
          out[j] = a;
        }
      }
      return out;
    },
  };
}
