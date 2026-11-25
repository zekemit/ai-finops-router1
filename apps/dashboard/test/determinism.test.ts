import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { summarize } from "@ai-finops/interceptor";
import { describe, expect, it } from "vitest";
import { seedEngine } from "../src/lib/scenario";

const LIB = join(import.meta.dirname, "..", "src", "lib");
const files = readdirSync(LIB).filter((f) => f.endsWith(".ts"));
const read = (f: string): string => readFileSync(join(LIB, f), "utf8");

/**
 * The page is server-rendered in Node and re-rendered in the browser. If the seeded simulator is not
 * bit-for-bit portable between JavaScript engines, React reports a hydration mismatch (and the two
 * renders show different dollars). These guards ban the known ways to lose portability.
 */
describe("the simulator is portable across JavaScript engines", () => {
  it("never uses Math.random or the clock: the seed is the only source of variation", () => {
    expect(files.filter((f) => /Math\.random|Date\.now|new Date\(\)|performance\.now/.test(read(f)))).toEqual([]);
  });

  it("never shuffles with a random sort comparator, whose call order differs between engines", () => {
    expect(files.filter((f) => /\.sort\(\s*\(\s*\)\s*=>/.test(read(f)))).toEqual([]);
    expect(files.filter((f) => /\.sort\([^)]*(rng|random)/i.test(read(f)))).toEqual([]);
  });
});

describe("the opening seed is pinned", () => {
  // If this fails you changed the generator. Update the numbers deliberately and re-check the page in a browser:
  // the server render and the client render must show these same figures.
  it("seed 42 opens on the documented history", () => {
    const state = seedEngine(42);
    const summary = summarize(state.events);
    expect({
      features: summary.featuresShipped,
      modelCalls: summary.calls,
      scriptedTasks: state.offloads.length,
      tasksSeen: state.interceptedCalls,
      loopsCaught: state.loopAlerts.length,
      totalSpend: Number(summary.totalCostUsd.toFixed(2)),
    }).toMatchInlineSnapshot(`
      {
        "features": 12,
        "loopsCaught": 1,
        "modelCalls": 101,
        "scriptedTasks": 84,
        "tasksSeen": 189,
        "totalSpend": 6.82,
      }
    `);
  });
});
