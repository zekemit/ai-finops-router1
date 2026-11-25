import { describe, expect, it } from "vitest";
import { DAYS_PER_MONTH, DEFAULT_ROI_INPUTS, ROI_LIMITS, computeRoi, normalizeInputs } from "../src/lib/roi";
import type { RoiInputs } from "../src/lib/roi";

// Hand-computed fixture. Sonnet 5.5: $2 in, $10 out, $0.10 cache read, $2.50 cache write (5m).
//   prompt 10 agents x 10M = 100M tokens/day; 90% read = 90M; 10% written = 10M; output 3% = 3M
//   cached  = 90M*$0.10 + 10M*$2.50 + 3M*$10        = 9 + 25 + 30 = $64/day
//   baseline = 100M*$2 + 3M*$10                      = 200 + 30    = $230/day
const BASE: RoiInputs = { agents: 10, dailyTokensM: 10, cacheHitRate: 0.9, model: "claude-sonnet-5-5", mechanicalShare: 0.2, valuePerAgentDayUsd: 100 };

describe("computeRoi — spend, to the cent", () => {
  const r = computeRoi(BASE);

  it("derives daily token volumes from the inputs", () => {
    expect(r.tokensPerDay).toEqual({ prompt: 100_000_000, cacheRead: 90_000_000, cacheWrite: 10_000_000, output: 3_000_000 });
  });

  it("prices the day with and without caching using the interceptor's cost engine", () => {
    expect(r.daily.baselineUsd).toBeCloseTo(230, 9);
    expect(r.daily.cachedUsd).toBeCloseTo(64, 9);
  });

  it("splits savings into caching first, then scripts on what caching left", () => {
    expect(r.daily.cacheSavingsUsd).toBeCloseTo(166, 9);
    expect(r.daily.scriptSavingsUsd).toBeCloseTo(12.8, 9); // 20% of the $64 that would still have been spent
    expect(r.daily.optimizedUsd).toBeCloseTo(51.2, 9);
    expect(r.daily.totalSavingsUsd).toBeCloseTo(178.8, 9);
    expect(r.daily.savingsPct).toBeCloseTo(178.8 / 230, 12);
  });

  it("keeps the identity baseline = optimized + total savings", () => {
    expect(r.daily.optimizedUsd + r.daily.totalSavingsUsd).toBeCloseTo(r.daily.baselineUsd, 9);
    expect(r.monthly.optimizedUsd + r.monthly.totalSavingsUsd).toBeCloseTo(r.monthly.baselineUsd, 9);
  });

  it("scales a day to a 30-day month", () => {
    expect(DAYS_PER_MONTH).toBe(30);
    expect(r.monthly.baselineUsd).toBeCloseTo(6_900, 6);
    expect(r.monthly.optimizedUsd).toBeCloseTo(1_536, 6);
    expect(r.monthly.totalSavingsUsd).toBeCloseTo(5_364, 6);
  });

  it("states the cost multiplier and the per-agent daily cost", () => {
    expect(r.costMultiplier).toBeCloseTo(230 / 51.2, 9);
    expect(r.perAgentDayUsd.baseline).toBeCloseTo(23, 9);
    expect(r.perAgentDayUsd.optimized).toBeCloseTo(5.12, 9);
  });

  it("reports the money saved per second, for a live counter", () => {
    expect(r.savedPerSecondUsd).toBeCloseTo(178.8 / 86_400, 12);
  });

  it("prices Opus 5.5 at its own rates", () => {
    // $4 in, $20 out, $0.20 read, $5 write: cached 18 + 50 + 60 = 128; baseline 400 + 60 = 460
    const opus = computeRoi({ ...BASE, model: "claude-opus-5-5" });
    expect(opus.daily.cachedUsd).toBeCloseTo(128, 9);
    expect(opus.daily.baselineUsd).toBeCloseTo(460, 9);
  });

  it("scales linearly with agents and leaves percentages alone", () => {
    const double = computeRoi({ ...BASE, agents: 20 });
    expect(double.daily.baselineUsd).toBeCloseTo(r.daily.baselineUsd * 2, 6);
    expect(double.daily.optimizedUsd).toBeCloseTo(r.daily.optimizedUsd * 2, 6);
    expect(double.daily.savingsPct).toBeCloseTo(r.daily.savingsPct, 12);
  });
});

describe("computeRoi — caching can cost more than it saves", () => {
  it("shows negative cache savings at a 0% hit rate instead of hiding it (every token is a 1.25x write)", () => {
    const r = computeRoi({ ...BASE, cacheHitRate: 0, mechanicalShare: 0 });
    expect(r.daily.cachedUsd).toBeCloseTo(280, 9);
    expect(r.daily.cacheSavingsUsd).toBeCloseTo(-50, 9);
    expect(r.daily.savingsPct).toBeCloseTo(-50 / 230, 12);
  });

  it("reports the break-even hit rate from the model's own price ratios", () => {
    const { cacheBreakEvenHitRate } = computeRoi(BASE);
    expect(cacheBreakEvenHitRate).toBeCloseTo(0.25 / 1.2, 9); // (write-1) / (write-read), read = 0.05x, write = 1.25x
    expect(computeRoi({ ...BASE, model: "claude-opus-5-5" }).cacheBreakEvenHitRate).toBeCloseTo(0.25 / 1.2, 9);
  });

  it("flips sign exactly around the break-even rate", () => {
    expect(computeRoi({ ...BASE, cacheHitRate: 0.25, mechanicalShare: 0 }).daily.cacheSavingsUsd).toBeGreaterThan(0);
    expect(computeRoi({ ...BASE, cacheHitRate: 0.15, mechanicalShare: 0 }).daily.cacheSavingsUsd).toBeLessThan(0);
  });

  it("saves more as the hit rate rises", () => {
    const rates = [0.3, 0.5, 0.7, 0.9, 0.99];
    const pcts = rates.map((cacheHitRate) => computeRoi({ ...BASE, cacheHitRate, mechanicalShare: 0 }).daily.savingsPct);
    for (let i = 1; i < pcts.length; i += 1) expect(pcts[i] ?? 0).toBeGreaterThan(pcts[i - 1] ?? 0);
  });

  it("saves more as the share of scripted tasks rises", () => {
    const a = computeRoi({ ...BASE, mechanicalShare: 0.1 }).daily.totalSavingsUsd;
    const b = computeRoi({ ...BASE, mechanicalShare: 0.5 }).daily.totalSavingsUsd;
    expect(b).toBeGreaterThan(a);
  });
});

describe("computeRoi — gross margin", () => {
  const r = computeRoi(BASE);

  it("is revenue minus AI spend over revenue, before and after", () => {
    expect(r.revenueMonthlyUsd).toBe(30_000);
    expect(r.grossMargin.withoutPct).toBeCloseTo(0.77, 12);
    expect(r.grossMargin.withPct).toBeCloseTo(0.9488, 12);
    expect(r.grossMargin.gainPoints).toBeCloseTo(0.1788, 12);
  });

  it("states the margin multiplier as margin with / margin without", () => {
    expect(r.marginMultiplier).toBeCloseTo(0.9488 / 0.77, 12);
  });

  it("has no margins at all when revenue is zero", () => {
    const zero = computeRoi({ ...BASE, valuePerAgentDayUsd: 0 });
    expect(zero.grossMargin).toEqual({ withoutPct: null, withPct: null, gainPoints: null });
    expect(zero.marginMultiplier).toBeNull();
  });

  it("refuses a margin multiplier when the unoptimised margin is not positive, but still reports the gain", () => {
    const loss = computeRoi({ ...BASE, valuePerAgentDayUsd: 10 }); // revenue 3,000 < baseline 6,900
    expect(loss.grossMargin.withoutPct).toBeCloseTo(-1.3, 12);
    expect(loss.marginMultiplier).toBeNull();
    expect(loss.grossMargin.withPct).toBeCloseTo(0.488, 12);
    expect(loss.grossMargin.gainPoints).toBeCloseTo(1.788, 12);
  });
});

describe("computeRoi — input validation", () => {
  it.each([
    ["agents", { agents: 0 }],
    ["agents", { agents: 201 }],
    ["agents", { agents: 1.5 }],
    ["dailyTokensM", { dailyTokensM: 0 }],
    ["cacheHitRate", { cacheHitRate: 1 }],
    ["cacheHitRate", { cacheHitRate: -0.1 }],
    ["mechanicalShare", { mechanicalShare: 0.9 }],
    ["valuePerAgentDayUsd", { valuePerAgentDayUsd: -1 }],
    ["agents", { agents: Number.NaN }],
    ["dailyTokensM", { dailyTokensM: Number.POSITIVE_INFINITY }],
  ])("rejects an out-of-range %s with a RangeError that names it", (field, bad) => {
    expect(() => computeRoi({ ...BASE, ...bad })).toThrow(RangeError);
    expect(() => computeRoi({ ...BASE, ...bad })).toThrow(field);
  });

  it("rejects a model it has no price for", () => {
    expect(() => computeRoi({ ...BASE, model: "gpt-4o" as RoiInputs["model"] })).toThrow(RangeError);
  });

  it("accepts every limit exactly", () => {
    for (const field of ["agents", "dailyTokensM", "cacheHitRate", "mechanicalShare", "valuePerAgentDayUsd"] as const) {
      const { min, max } = ROI_LIMITS[field];
      expect(() => computeRoi({ ...BASE, [field]: min })).not.toThrow();
      expect(() => computeRoi({ ...BASE, [field]: max })).not.toThrow();
    }
  });
});

describe("normalizeInputs — turning arbitrary UI values into valid inputs", () => {
  it("clamps to the limits", () => {
    const n = normalizeInputs({ agents: 500, dailyTokensM: 0.01, cacheHitRate: 2, mechanicalShare: -3, valuePerAgentDayUsd: 99_999 });
    expect(n).toMatchObject({ agents: 200, dailyTokensM: 0.1, cacheHitRate: 0.99, mechanicalShare: 0, valuePerAgentDayUsd: 2_000 });
  });

  it("snaps to each field's step, and agents to whole numbers", () => {
    const n = normalizeInputs({ agents: 3.7, cacheHitRate: 0.456, dailyTokensM: 12.34, valuePerAgentDayUsd: 124 });
    expect(n).toMatchObject({ agents: 4, cacheHitRate: 0.46, dailyTokensM: 12.3, valuePerAgentDayUsd: 120 });
  });

  it("falls back to the default for anything that is not a finite number or a known model", () => {
    const n = normalizeInputs({ agents: Number.NaN, cacheHitRate: "lots", model: "gpt-4o", dailyTokensM: undefined });
    expect(n).toEqual(DEFAULT_ROI_INPUTS);
  });

  it("always produces something computeRoi accepts", () => {
    for (const junk of [-1e9, 0, 0.5, 7, 1e9, Number.NaN, Number.POSITIVE_INFINITY]) {
      const n = normalizeInputs({ agents: junk, dailyTokensM: junk, cacheHitRate: junk, mechanicalShare: junk, valuePerAgentDayUsd: junk });
      expect(() => computeRoi(n)).not.toThrow();
    }
  });
});

describe("DEFAULT_ROI_INPUTS", () => {
  it("is a plausible, valid starting scenario whose savings stay believable", () => {
    const r = computeRoi(DEFAULT_ROI_INPUTS);
    expect(r.daily.savingsPct).toBeGreaterThan(0.6);
    expect(r.daily.savingsPct).toBeLessThan(0.95);
    expect(r.grossMargin.gainPoints ?? 0).toBeGreaterThan(0);
  });
});
