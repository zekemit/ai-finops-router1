import { summarize } from "@ai-finops/interceptor";
import { combineSavings, summarizeOffloads } from "@ai-finops/router";
import { describe, expect, it } from "vitest";
import { HISTORY_SPRINTS, historyTimeline, liveSprintTimeline, seedEngine, sprintStart } from "../src/lib/scenario";

const savingsFor = (seed: number) => {
  const state = seedEngine(seed);
  return combineSavings(summarize(state.events), summarizeOffloads(state.offloads));
};

describe("seeded history", () => {
  const state = seedEngine(42);

  it("ships 12 features across three sprints", () => {
    expect(summarize(state.events).featuresShipped).toBe(12);
    expect(HISTORY_SPRINTS).toBe(3);
  });

  it("includes a caught runaway loop, with the breaker having prevented later repeats", () => {
    expect(state.loopAlerts.length).toBeGreaterThanOrEqual(1);
    expect(state.prevented.calls).toBeGreaterThan(0);
    expect(state.prevented.usd).toBeGreaterThan(0);
  });

  it("shows script offloading from all four deterministic rules", () => {
    const rules = new Set(state.offloads.map((o) => o.rule_id));
    expect([...rules].sort()).toEqual(["grep-search", "json-format", "lint-check", "test-summary"]);
  });

  it("is reproducible per seed and different across seeds", () => {
    expect(seedEngine(42)).toEqual(state);
    expect(summarize(seedEngine(43).events).totalCostUsd).not.toBe(summarize(state.events).totalCostUsd);
  });

  it("puts the live sprint strictly after the last historical task", () => {
    const history = historyTimeline(42);
    const live = liveSprintTimeline(42, HISTORY_SPRINTS);
    expect(live[0]?.atMs ?? 0).toBeGreaterThan(history[history.length - 1]?.atMs ?? Infinity);
    expect(sprintStart(HISTORY_SPRINTS)).toBeLessThanOrEqual(live[0]?.atMs ?? 0);
  });
});

describe("headline requirement: caching plus deterministic routing cut the bill by 65%+", () => {
  it("holds for every one of 25 seeds, not a hand-picked one", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const pct = savingsFor(seed).totalSavingsPct;
      expect(pct, `seed ${seed}`).toBeGreaterThanOrEqual(0.65);
    }
  });

  it("stays believable: below 95%, with both caching and offloading contributing", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const s = savingsFor(seed);
      expect(s.totalSavingsPct, `seed ${seed}`).toBeLessThan(0.95);
      expect(s.cacheSavingsUsd).toBeGreaterThan(0);
      expect(s.offloadSavingsUsd).toBeGreaterThan(0);
    }
  });

  it("counts savings only against calls that really happened or were really offloaded", () => {
    const state = seedEngine(42);
    const s = combineSavings(summarize(state.events), summarizeOffloads(state.offloads));
    expect(s.actualUsd).toBeCloseTo(summarize(state.events).totalCostUsd, 12);
    expect(s.counterfactualUsd).toBeGreaterThan(s.actualUsd);
  });
});
