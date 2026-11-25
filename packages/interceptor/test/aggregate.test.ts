import { describe, expect, it } from "vitest";
import { summarize } from "../src/aggregate";
import type { PricingTable } from "../src/pricing";
import { makeEvent } from "./helpers";

// Hand-computed fixtures
//  PM (sonnet-5-5: $2 in / $10 out / $0.10 read): in 1,000  out 500  read 9,000
//     cost = 0.002 + 0.005 + 0.0009 = 0.0079     baseline = 10,000*$2/M + 0.005 = 0.025   savings = 0.0171
//  Architect (opus-5-5: $4 in / $20 out / $5 5m-write): in 2,000  out 1,000  5m-write 8,000
//     cost = 0.008 + 0.02 + 0.04 = 0.068         baseline = 10,000*$4/M + 0.02 = 0.06     savings = -0.008
const pm = () =>
  makeEvent({ agent: "PM_Agent", model: "claude-sonnet-5-5", usage: { inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 9_000 } });
const architect = () =>
  makeEvent({ agent: "Architect_Agent", model: "claude-opus-5-5", usage: { inputTokens: 2_000, outputTokens: 1_000, cacheWrite5mTokens: 8_000 } });

describe("summarize — totals", () => {
  it("sums billed cost, baseline and savings across agents and models", () => {
    const s = summarize([pm(), architect()]);
    expect(s.calls).toBe(2);
    expect(s.totalCostUsd).toBeCloseTo(0.0759, 10);
    expect(s.baselineUsd).toBeCloseTo(0.085, 10);
    expect(s.cacheSavingsUsd).toBeCloseTo(0.0091, 10);
    expect(s.cacheSavingsPct).toBeCloseTo(0.0091 / 0.085, 10);
  });

  it("computes the cache hit rate over total tokens, not as an average of per-call rates", () => {
    // reads 9,000 / (prompt 10,000 + 10,000) = 0.45  (an average of 0.9 and 0 would be 0.45 too, so skew it)
    const skewed = summarize([
      makeEvent({ usage: { cacheReadTokens: 900, inputTokens: 100 } }), // 0.9
      makeEvent({ usage: { inputTokens: 9_000 } }), // 0.0, but 9x the volume
    ]);
    expect(skewed.cacheHitRate).toBeCloseTo(900 / 10_000, 10); // 0.09, not 0.45
  });

  it("returns zeros and nulls for no events", () => {
    const s = summarize([]);
    expect(s.calls).toBe(0);
    expect(s.totalCostUsd).toBe(0);
    expect(s.cacheSavingsPct).toBe(0);
    expect(s.cacheHitRate).toBe(0);
    expect(s.avgLatencyMs).toBeNull();
    expect(s.p95LatencyMs).toBeNull();
    expect(s.costPerFeatureUsd).toBeNull();
    expect(s.byAgent.map((a) => a.agent)).toEqual(["PM_Agent", "Architect_Agent", "Security_Agent", "Release_Agent"]);
  });
});

describe("summarize — cost per subagent", () => {
  it("attributes each call's cost to its agent", () => {
    const s = summarize([pm(), pm(), architect()]);
    const byName = new Map(s.byAgent.map((a) => [a.agent, a]));
    expect(byName.get("PM_Agent")?.calls).toBe(2);
    expect(byName.get("PM_Agent")?.costUsd).toBeCloseTo(0.0158, 10);
    expect(byName.get("Architect_Agent")?.costUsd).toBeCloseTo(0.068, 10);
    expect(byName.get("Architect_Agent")?.cacheSavingsUsd).toBeCloseTo(-0.008, 10);
    expect(byName.get("PM_Agent")?.cacheHitRate).toBeCloseTo(0.9, 10);
  });

  it("always lists the four subagents in canonical order, zero-filled, and Unattributed only when it has calls", () => {
    const quiet = summarize([pm()]);
    expect(quiet.byAgent.map((a) => a.agent)).toEqual(["PM_Agent", "Architect_Agent", "Security_Agent", "Release_Agent"]);
    expect(quiet.byAgent.find((a) => a.agent === "Security_Agent")?.calls).toBe(0);

    const withMain = summarize([pm(), makeEvent({ agent: "Unattributed" })]);
    expect(withMain.byAgent.map((a) => a.agent)).toEqual([
      "PM_Agent",
      "Architect_Agent",
      "Security_Agent",
      "Release_Agent",
      "Unattributed",
    ]);
  });

  it("breaks spend down by model", () => {
    const s = summarize([pm(), architect()]);
    expect(s.byModel.map((m) => m.model).sort()).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
    expect(s.byModel.find((m) => m.model === "claude-opus-5-5")?.costUsd).toBeCloseTo(0.068, 10);
  });
});

describe("summarize — pricing gaps are surfaced, never guessed", () => {
  it("excludes unknown models from dollar totals, still counts their tokens, and lists them", () => {
    const mystery = makeEvent({ model: "gpt-4o", usage: { inputTokens: 5_000, outputTokens: 1_000 } });
    const s = summarize([pm(), mystery, mystery]);
    expect(s.totalCostUsd).toBeCloseTo(0.0079, 10);
    expect(s.usage.inputTokens).toBe(1_000 + 10_000);
    expect(s.unpriced).toEqual([{ model: "gpt-4o", calls: 2 }]);
    // pm() is priced Sonnet; only the two `mystery` calls (also attributed to PM_Agent) are unpriced.
    expect(s.byAgent.find((a) => a.agent === "PM_Agent")?.unpricedCalls).toBe(2);
    expect(s.byAgent.find((a) => a.agent === "PM_Agent")?.calls).toBe(3);
  });

  it("lists models priced with an assumed cache-read rate", () => {
    const haiku = makeEvent({ model: "claude-haiku-4-5", usage: { inputTokens: 1 } });
    expect(summarize([pm(), haiku]).assumedPricingModels).toEqual(["claude-haiku-4-5"]);
    expect(summarize([pm()]).assumedPricingModels).toEqual([]);
  });

  it("honours a caller-supplied pricing table", () => {
    const custom: PricingTable = {
      "my-model": {
        model: "my-model",
        inputPerMTok: 10,
        outputPerMTok: 0,
        cacheReadPerMTok: 0,
        cacheWrite5mPerMTok: 0,
        cacheWrite1hPerMTok: 0,
        source: "documented",
      },
    };
    const s = summarize([makeEvent({ model: "my-model", usage: { inputTokens: 1_000_000 } })], custom);
    expect(s.totalCostUsd).toBe(10);
  });
});

describe("summarize — latency", () => {
  it("averages and takes the nearest-rank p95 over calls that have a latency, ignoring nulls", () => {
    const latencies = Array.from({ length: 20 }, (_, i) => (i + 1) * 100); // 100..2000
    const events = [...latencies.map((ms) => makeEvent({ latencyMs: ms })), makeEvent({ latencyMs: null })];
    const s = summarize(events);
    expect(s.avgLatencyMs).toBeCloseTo(1050, 10);
    expect(s.p95LatencyMs).toBe(1900); // ceil(0.95 * 20) = 19th value
  });
});

describe("summarize — unit economics", () => {
  it("divides total spend by distinct features that reached the feature_shipped milestone", () => {
    const events = [
      makeEvent({ usage: { outputTokens: 1_000_000 }, featureId: "f1" }), // $10
      makeEvent({ usage: { outputTokens: 1_000_000 }, featureId: "f1", milestone: "feature_shipped" }), // $10
      makeEvent({ usage: { outputTokens: 1_000_000 }, featureId: "f1", milestone: "feature_shipped" }), // same feature shipped twice
      makeEvent({ usage: { outputTokens: 1_000_000 }, featureId: "f2", milestone: "feature_shipped" }), // $10
    ];
    const s = summarize(events);
    expect(s.featuresShipped).toBe(2);
    expect(s.costPerFeatureUsd).toBe(20); // $40 / 2
  });

  it("reports null cost-per-feature when nothing shipped, instead of dividing by zero", () => {
    const s = summarize([makeEvent({ usage: { outputTokens: 1_000_000 }, featureId: "f1" })]);
    expect(s.featuresShipped).toBe(0);
    expect(s.costPerFeatureUsd).toBeNull();
  });
});
