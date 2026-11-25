import { describe, expect, it } from "vitest";
import { calculateCost, cacheHitRate } from "../src/cost";
import { DEFAULT_PRICING, resolvePricing } from "../src/pricing";
import type { ModelPricing, PricingTable } from "../src/pricing";
import { addUsage, makeUsage, totalPromptTokens, ZERO_USAGE } from "../src/usage";

function pricingFor(model: string): ModelPricing {
  const p = resolvePricing(model);
  if (p === undefined) throw new Error(`test setup: no pricing for ${model}`);
  return p;
}

describe("calculateCost — token math", () => {
  it("prices 1M input tokens at the model's input rate", () => {
    const cost = calculateCost(makeUsage({ inputTokens: 1_000_000 }), pricingFor("claude-sonnet-5-5"));
    expect(cost.inputUsd).toBe(2);
    expect(cost.totalUsd).toBe(2);
  });

  it("prices 1M output tokens at the model's output rate", () => {
    const cost = calculateCost(makeUsage({ outputTokens: 1_000_000 }), pricingFor("claude-opus-5-5"));
    expect(cost.outputUsd).toBe(20);
    expect(cost.totalUsd).toBe(20);
  });

  it("prices cache reads at the model-specific cache-read rate, not a flat 10% of input", () => {
    // Fable 5.2: $8 input, $0.20 cache read (0.025x). A flat 10% rule would give $0.80.
    const cost = calculateCost(makeUsage({ cacheReadTokens: 1_000_000 }), pricingFor("claude-fable-5-2"));
    expect(cost.cacheReadUsd).toBeCloseTo(0.2, 10);
  });

  it("prices 5-minute and 1-hour cache writes at different rates", () => {
    // Fable 5.2 documented: 5m write $10/MTok, 1h write $16/MTok.
    const p = pricingFor("claude-fable-5-2");
    const fiveMin = calculateCost(makeUsage({ cacheWrite5mTokens: 1_000_000 }), p);
    const oneHour = calculateCost(makeUsage({ cacheWrite1hTokens: 1_000_000 }), p);
    expect(fiveMin.cacheWriteUsd).toBeCloseTo(10, 10);
    expect(oneHour.cacheWriteUsd).toBeCloseTo(16, 10);
  });

  it("computes an exact total for a real-shaped Claude Code turn (Sonnet 5.5, 1h cache write)", () => {
    // Shape taken from a real session log: 2 uncached in, 800 out, 61,517 cache read, 55,115 1h write.
    // input 0.000004 + output 0.008 + read 0.0061517 + write 0.22046 = 0.2346157
    const cost = calculateCost(
      makeUsage({ inputTokens: 2, outputTokens: 800, cacheReadTokens: 61_517, cacheWrite1hTokens: 55_115 }),
      pricingFor("claude-sonnet-5-5"),
    );
    expect(cost.inputUsd).toBeCloseTo(0.000004, 12);
    expect(cost.outputUsd).toBeCloseTo(0.008, 12);
    expect(cost.cacheReadUsd).toBeCloseTo(0.0061517, 12);
    expect(cost.cacheWriteUsd).toBeCloseTo(0.22046, 12);
    expect(cost.totalUsd).toBeCloseTo(0.2346157, 12);
  });
});

describe("calculateCost — cache savings", () => {
  it("reports savings against a no-cache baseline that bills every prompt token at the input rate", () => {
    const cost = calculateCost(
      makeUsage({ inputTokens: 2, outputTokens: 800, cacheReadTokens: 61_517, cacheWrite1hTokens: 55_115 }),
      pricingFor("claude-sonnet-5-5"),
    );
    // baseline = (2 + 61,517 + 55,115) * $2/MTok + 800 * $10/MTok = 0.233268 + 0.008
    expect(cost.baselineUsd).toBeCloseTo(0.241268, 12);
    expect(cost.cacheSavingsUsd).toBeCloseTo(0.241268 - 0.2346157, 12);
  });

  it("shows large savings for a warm cache (reads dominate)", () => {
    const cost = calculateCost(makeUsage({ inputTokens: 1_000, cacheReadTokens: 999_000 }), pricingFor("claude-opus-5-5"));
    // baseline 1M * $4 = $4.00; actual 1,000*$4/M + 999,000*$0.20/M = 0.004 + 0.1998
    expect(cost.baselineUsd).toBeCloseTo(4, 10);
    expect(cost.totalUsd).toBeCloseTo(0.2038, 10);
    expect(cost.cacheSavingsUsd).toBeCloseTo(3.7962, 10);
  });

  it("goes negative when a cache write is never read back (the write premium is a real cost)", () => {
    const cost = calculateCost(makeUsage({ cacheWrite5mTokens: 1_000_000 }), pricingFor("claude-sonnet-5-5"));
    expect(cost.totalUsd).toBeCloseTo(2.5, 10);
    expect(cost.baselineUsd).toBeCloseTo(2, 10);
    expect(cost.cacheSavingsUsd).toBeCloseTo(-0.5, 10);
  });
});

describe("cacheHitRate", () => {
  it("is cache-read tokens divided by all prompt tokens", () => {
    const rate = cacheHitRate(makeUsage({ inputTokens: 2, cacheReadTokens: 61_517, cacheWrite1hTokens: 55_115 }));
    expect(rate).toBeCloseTo(61_517 / 116_634, 12);
  });

  it("is 0 — not NaN — when there are no prompt tokens", () => {
    expect(cacheHitRate(ZERO_USAGE)).toBe(0);
  });

  it("is 1 when the entire prompt is served from cache", () => {
    expect(cacheHitRate(makeUsage({ cacheReadTokens: 500 }))).toBe(1);
  });
});

describe("usage helpers", () => {
  it("addUsage sums every field and does not mutate its inputs", () => {
    const a = makeUsage({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWrite5mTokens: 4, cacheWrite1hTokens: 5 });
    const b = makeUsage({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWrite5mTokens: 40, cacheWrite1hTokens: 50 });
    const sum = addUsage(a, b);
    expect(sum).toEqual({ inputTokens: 11, outputTokens: 22, cacheReadTokens: 33, cacheWrite5mTokens: 44, cacheWrite1hTokens: 55 });
    expect(a.inputTokens).toBe(1);
  });

  it("totalPromptTokens counts input, cache reads and both cache-write tiers but not output", () => {
    const u = makeUsage({ inputTokens: 1, outputTokens: 999, cacheReadTokens: 2, cacheWrite5mTokens: 3, cacheWrite1hTokens: 4 });
    expect(totalPromptTokens(u)).toBe(10);
  });

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ])("rejects %s token counts so bad telemetry can never produce a plausible-looking cost", (_label, bad) => {
    expect(() => makeUsage({ inputTokens: bad })).toThrow(RangeError);
  });
});

describe("pricing table", () => {
  it("resolves an exact model id", () => {
    expect(resolvePricing("claude-sonnet-5-5")?.inputPerMTok).toBe(2);
  });

  it("resolves a dated snapshot id by stripping the -YYYYMMDD suffix", () => {
    expect(resolvePricing("claude-haiku-4-5-20251001")?.model).toBe("claude-haiku-4-5");
  });

  it("resolves Claude Code's context-window suffixed ids like claude-opus-4-6[1m]", () => {
    expect(resolvePricing("claude-opus-4-6[1m]")?.model).toBe("claude-opus-4-6");
  });

  it("returns undefined for an unknown model instead of guessing a price", () => {
    expect(resolvePricing("gpt-4o")).toBeUndefined();
    expect(resolvePricing("")).toBeUndefined();
  });

  it("lets callers override pricing with their own table", () => {
    const custom: PricingTable = {
      "my-model": {
        model: "my-model",
        inputPerMTok: 1,
        outputPerMTok: 2,
        cacheReadPerMTok: 0.5,
        cacheWrite5mPerMTok: 1.25,
        cacheWrite1hPerMTok: 2,
        source: "documented",
      },
    };
    expect(resolvePricing("my-model", custom)?.outputPerMTok).toBe(2);
    expect(resolvePricing("claude-sonnet-5-5", custom)).toBeUndefined();
  });

  it("keeps cache-write rates at the documented 1.25x (5m) and 2x (1h) of input for every entry", () => {
    for (const p of Object.values(DEFAULT_PRICING)) {
      expect(p.cacheWrite5mPerMTok).toBeCloseTo(p.inputPerMTok * 1.25, 10);
      expect(p.cacheWrite1hPerMTok).toBeCloseTo(p.inputPerMTok * 2, 10);
    }
  });

  it("flags entries whose cache-read rate is not stated in the bundled docs as 'assumed'", () => {
    expect(resolvePricing("claude-sonnet-5-5")?.source).toBe("documented");
    expect(resolvePricing("claude-fable-5-2")?.source).toBe("documented");
    expect(resolvePricing("claude-haiku-4-5")?.source).toBe("assumed");
  });

  it("encodes the published per-model cache-read rates", () => {
    expect(pricingFor("claude-fable-5-2").cacheReadPerMTok).toBe(0.2);
    expect(pricingFor("claude-fable-5-1").cacheReadPerMTok).toBe(0.25);
    expect(pricingFor("claude-fable-5").cacheReadPerMTok).toBe(1);
    expect(pricingFor("claude-opus-5-5").cacheReadPerMTok).toBe(0.2);
    expect(pricingFor("claude-sonnet-5-5").cacheReadPerMTok).toBe(0.1);
  });
});
