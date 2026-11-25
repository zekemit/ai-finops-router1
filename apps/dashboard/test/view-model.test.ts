import { describe, expect, it } from "vitest";
import { EMPTY_ENGINE, applyItem } from "../src/lib/engine";
import { seedEngine } from "../src/lib/scenario";
import { computeKpis, spendSeries, sprintRows } from "../src/lib/view-model";
import { T0, llmItem, scriptItem } from "./helpers";

const iso = (ms: number) => new Date(ms).toISOString();

describe("computeKpis — unit economics", () => {
  const state = [
    llmItem({ id: "a", atMs: T0, featureId: "F1" }),
    llmItem({ id: "b", atMs: T0 + 5_000, featureId: "F1", milestone: "feature_shipped" }),
    scriptItem({ id: "s", atMs: T0 + 6_000 }),
  ].reduce(applyItem, EMPTY_ENGINE);
  const saved = state.offloads[0]?.offloaded_savings_usd ?? 0;

  it("totals spend and divides it by features shipped", () => {
    const kpis = computeKpis(state, null, false);
    expect(kpis.totalSpendUsd).toBeCloseTo(20, 12);
    expect(kpis.featuresShipped).toBe(1);
    expect(kpis.costPerFeatureUsd).toBeCloseTo(20, 12);
  });

  it("states what a feature would have cost without caching or scripts", () => {
    expect(computeKpis(state, null, false).counterfactualPerFeatureUsd).toBeCloseTo(20 + saved, 12);
  });

  it("combines cache and script savings against the no-optimisation bill", () => {
    const { savings } = computeKpis(state, null, false);
    expect(savings.offloadSavingsUsd).toBeCloseTo(saved, 12);
    expect(savings.totalSavingsPct).toBeCloseTo(saved / (20 + saved), 12);
  });

  it("has no cost per feature until something ships", () => {
    const none = [llmItem({ id: "a", atMs: T0 })].reduce(applyItem, EMPTY_ENGINE);
    const kpis = computeKpis(none, null, false);
    expect(kpis.costPerFeatureUsd).toBeNull();
    expect(kpis.counterfactualPerFeatureUsd).toBeNull();
  });

  it("is all zeros for an empty state", () => {
    const kpis = computeKpis(EMPTY_ENGINE, null, false);
    expect(kpis.totalSpendUsd).toBe(0);
    expect(kpis.savings.totalSavingsPct).toBe(0);
    expect(kpis.burn.usdPerMinute).toBe(0);
  });

  it("reports the dollars lost to a loop and the dollars the breaker prevented", () => {
    const loop = [1, 2, 3, 4, 5, 6].map((i) => llmItem({ id: `l${i}`, atMs: T0 + i * 8_000, prompt: "Resolve vulnerabilities" })).reduce(applyItem, EMPTY_ENGINE);
    const kpis = computeKpis(loop, null, false);
    expect(kpis.loopWastedUsd).toBeCloseTo(30, 12);
    expect(kpis.preventedUsd).toBeCloseTo(20, 12);
  });
});

describe("computeKpis — burn rate", () => {
  const state = [
    llmItem({ id: "a", atMs: T0, agent: "PM_Agent", latencyMs: 1_000 }),
    llmItem({ id: "b", atMs: T0 + 30_000, agent: "Architect_Agent", latencyMs: 1_000 }),
    llmItem({ id: "old", atMs: T0 - 600_000, agent: "Release_Agent" }),
  ].reduce(applyItem, EMPTY_ENGINE);

  it("live: dollars per minute over the trailing 60s of simulated time, with the agents active in it", () => {
    const { burn } = computeKpis(state, T0 + 40_000, true);
    expect(burn.usdPerMinute).toBeCloseTo(20, 12);
    expect(burn.activeAgents).toEqual(["PM_Agent", "Architect_Agent"]);
    expect(burn.live).toBe(true);
    expect(burn.byAgent.map((a) => a.agent)).toEqual(["PM_Agent", "Architect_Agent"]);
  });

  it("idle: shows the last minute of recorded activity instead of a dead zero", () => {
    const { burn } = computeKpis(state, null, false);
    expect(burn.usdPerMinute).toBeGreaterThan(0);
    expect(burn.live).toBe(false);
    expect(burn.atMs).toBe(T0 + 30_000 + 1_000);
  });

  it("drops to zero live once the window has passed", () => {
    expect(computeKpis(state, T0 + 600_000, true).burn.usdPerMinute).toBe(0);
  });
});

describe("spendSeries", () => {
  const items = Array.from({ length: 30 }, (_, i) => llmItem({ id: `e${i}`, atMs: T0 + i * 10_000 }));
  const state = [...items, scriptItem({ id: "s", atMs: T0 + 155_000 })].reduce(applyItem, EMPTY_ENGINE);

  it("is cumulative and never decreases, for both lines", () => {
    const series = spendSeries(state);
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i]?.actualUsd ?? 0).toBeGreaterThanOrEqual(series[i - 1]?.actualUsd ?? 0);
      expect(series[i]?.withoutOptimizationUsd ?? 0).toBeGreaterThanOrEqual(series[i - 1]?.withoutOptimizationUsd ?? 0);
    }
  });

  it("ends exactly at total spend and at the no-optimisation total", () => {
    const series = spendSeries(state);
    const last = series[series.length - 1];
    const kpis = computeKpis(state, null, false);
    expect(last?.actualUsd).toBeCloseTo(kpis.totalSpendUsd, 12);
    expect(last?.withoutOptimizationUsd).toBeCloseTo(kpis.savings.counterfactualUsd, 12);
  });

  it("counts a scripted task on the without-optimisation line only", () => {
    const series = spendSeries(state);
    const before = series.filter((p) => p.atMs < T0 + 155_000);
    const after = series.find((p) => p.atMs === T0 + 155_000);
    expect(after).toBeDefined();
    expect((after?.actualUsd ?? 0)).toBeCloseTo(before[before.length - 1]?.actualUsd ?? 0, 12);
    expect((after?.withoutOptimizationUsd ?? 0)).toBeGreaterThan(before[before.length - 1]?.withoutOptimizationUsd ?? 0);
  });

  it("downsamples long histories but keeps the first and last points", () => {
    const big = seedEngine(42);
    const full = spendSeries(big, 100_000);
    const sampled = spendSeries(big, 100);
    expect(full.length).toBeGreaterThan(150);
    expect(sampled.length).toBeLessThanOrEqual(100);
    expect(sampled[0]).toEqual(full[0]);
    expect(sampled[sampled.length - 1]).toEqual(full[full.length - 1]);
  });

  it("is empty with no activity", () => {
    expect(spendSeries(EMPTY_ENGINE)).toEqual([]);
  });

  it("timestamps points with the call's completion time", () => {
    const one = [llmItem({ id: "z", atMs: T0, latencyMs: 4_000 })].reduce(applyItem, EMPTY_ENGINE);
    expect(iso(spendSeries(one)[0]?.atMs ?? 0)).toBe(iso(T0 + 4_000));
  });
});

describe("computeKpis — tokens avoided by scripts", () => {
  const state = seedEngine(42);
  const kpis = computeKpis(state, null, false);

  it("reports fresh tokens per rule: what the model would have read or written, excluding re-read cached context", () => {
    for (const rule of ["json-format", "test-summary", "lint-check", "grep-search"] as const) {
      const mine = state.offloads.filter((o) => o.rule_id === rule);
      const expected = mine.reduce((sum, o) => sum + o.avoided_input_tokens + o.avoided_output_tokens, 0);
      expect(kpis.offloadTokensByRule[rule], rule).toBe(expected);
      expect(expected, rule).toBeGreaterThan(0);
    }
  });

  it("is far smaller than the router's all-in count, which includes cached context", () => {
    const fresh = Object.values(kpis.offloadTokensByRule).reduce((a, b) => a + b, 0);
    expect(fresh).toBeLessThan(kpis.offloads.avoidedTokens / 2);
  });
});

describe("sprintRows — the table behind the chart", () => {
  const state = seedEngine(42);
  const rows = sprintRows(state);

  it("has one row per sprint, in order, labelled for people", () => {
    expect(rows.map((r) => r.label)).toEqual(["Sprint 1", "Sprint 2", "Sprint 3"]);
    expect(rows.map((r) => r.sessionId)).toEqual(["sprint-0", "sprint-1", "sprint-2"]);
    expect(rows.every((r) => r.features === 4)).toBe(true);
  });

  it("adds up to the dashboard totals, so the table can never disagree with the cards", () => {
    const kpis = computeKpis(state, null, false);
    expect(rows.reduce((s, r) => s + r.spendUsd, 0)).toBeCloseTo(kpis.totalSpendUsd, 10);
    expect(rows.reduce((s, r) => s + r.withoutOptimizationUsd, 0)).toBeCloseTo(kpis.savings.counterfactualUsd, 10);
  });

  it("states what each sprint saved, in dollars and as a share of what it would have cost", () => {
    for (const r of rows) {
      expect(r.savedUsd).toBeCloseTo(r.withoutOptimizationUsd - r.spendUsd, 10);
      expect(r.savedPct).toBeCloseTo(r.savedUsd / r.withoutOptimizationUsd, 10);
      expect(r.savedPct).toBeGreaterThan(0.65);
    }
  });

  it("is empty with no activity", () => {
    expect(sprintRows(EMPTY_ENGINE)).toEqual([]);
  });
});
