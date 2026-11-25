import { summarize } from "@ai-finops/interceptor";
import type { TelemetryEvent } from "@ai-finops/interceptor";
import { describe, expect, it } from "vitest";
import { combineSavings } from "../src/combine";
import { summarizeOffloads } from "../src/summary";
import type { OffloadRecord, RuleId } from "../src/types";

const record = (rule: RuleId, tokens: number, usd: number, priced = true): OffloadRecord => ({
  task_id: `${rule}-${tokens}`,
  timestamp: "2026-11-25T10:00:00.000Z",
  agent: "Security_Agent",
  model: "claude-sonnet-5-5",
  rule_id: rule,
  avoided_input_tokens: tokens,
  avoided_cache_read_tokens: 0,
  avoided_output_tokens: 0,
  avoided_tokens: tokens,
  offloaded_savings_usd: usd,
  priced,
  token_counts: "estimated",
});

describe("summarizeOffloads", () => {
  const records = [record("lint-check", 1_000, 0.25), record("lint-check", 3_000, 0.75), record("grep-search", 500, 0.5), record("json-format", 100, 0, false)];

  it("totals tokens and dollars and averages savings per offloaded call", () => {
    const s = summarizeOffloads(records);
    expect(s.offloadedCalls).toBe(4);
    expect(s.avoidedTokens).toBe(4_600);
    expect(s.savedUsd).toBeCloseTo(1.5, 12);
    expect(s.avgSavedPerCallUsd).toBeCloseTo(0.375, 12);
  });

  it("breaks savings down by rule, always listing all four rules in canonical order", () => {
    const s = summarizeOffloads(records);
    expect(s.byRule).toEqual([
      { ruleId: "json-format", calls: 1, avoidedTokens: 100, savedUsd: 0 },
      { ruleId: "test-summary", calls: 0, avoidedTokens: 0, savedUsd: 0 },
      { ruleId: "lint-check", calls: 2, avoidedTokens: 4_000, savedUsd: 1 },
      { ruleId: "grep-search", calls: 1, avoidedTokens: 500, savedUsd: 0.5 },
    ]);
  });

  it("counts offloads that had no pricing so the dollar figure is never presented as complete", () => {
    expect(summarizeOffloads(records).unpricedCalls).toBe(1);
  });

  it("expresses savings as a share of what the calls would have cost: saved / (actual + saved)", () => {
    expect(summarizeOffloads(records, { actualSpendUsd: 4.5 }).savingsPct).toBeCloseTo(1.5 / 6, 12);
  });

  it("reports what fraction of intercepted calls never reached the LLM", () => {
    expect(summarizeOffloads(records, { interceptedCalls: 16 }).offloadRate).toBe(0.25);
  });

  it("leaves share and rate null when they cannot be computed", () => {
    const s = summarizeOffloads(records);
    expect(s.savingsPct).toBeNull();
    expect(s.offloadRate).toBeNull();
    expect(summarizeOffloads(records, { interceptedCalls: 0 }).offloadRate).toBeNull();
  });

  it("is all zeros for no records", () => {
    const s = summarizeOffloads([]);
    expect(s).toMatchObject({ offloadedCalls: 0, avoidedTokens: 0, savedUsd: 0, avgSavedPerCallUsd: 0, unpricedCalls: 0 });
    expect(s.byRule).toHaveLength(4);
  });
});

describe("combineSavings", () => {
  // sonnet-5-5 ($2 in / $10 out / $0.10 read): 2M cache-read tokens + 100K output tokens
  //   actual   = 2,000,000*$0.10/M + 100,000*$10/M = 0.20 + 1.00 = 1.20
  //   baseline = 2,000,000*$2/M    + 1.00          = 4.00 + 1.00 = 5.00   -> cache savings 3.80
  const event: TelemetryEvent = {
    id: "e1",
    timestamp: "2026-11-25T10:00:00.000Z",
    sessionId: "s",
    agent: "PM_Agent",
    model: "claude-sonnet-5-5",
    usage: { inputTokens: 0, outputTokens: 100_000, cacheReadTokens: 2_000_000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 },
    latencyMs: null,
    source: "api-payload",
  };

  it("adds cache savings and script-offload savings against the no-cache, no-offload counterfactual", () => {
    const telemetry = summarize([event]);
    const offloads = summarizeOffloads([record("grep-search", 1, 0.5)]);
    const c = combineSavings(telemetry, offloads);
    expect(c.actualUsd).toBeCloseTo(1.2, 12);
    expect(c.cacheSavingsUsd).toBeCloseTo(3.8, 12);
    expect(c.offloadSavingsUsd).toBeCloseTo(0.5, 12);
    expect(c.totalSavingsUsd).toBeCloseTo(4.3, 12);
    expect(c.counterfactualUsd).toBeCloseTo(5.5, 12); // 5.00 baseline + 0.50 of calls that never happened
    expect(c.totalSavingsPct).toBeCloseTo(4.3 / 5.5, 12);
  });

  it("reduces to cache-only savings when nothing was offloaded", () => {
    const c = combineSavings(summarize([event]), summarizeOffloads([]));
    expect(c.totalSavingsUsd).toBeCloseTo(3.8, 12);
    expect(c.totalSavingsPct).toBeCloseTo(3.8 / 5, 12);
  });

  it("is zero, not NaN, when there is no traffic at all", () => {
    const c = combineSavings(summarize([]), summarizeOffloads([]));
    expect(c.totalSavingsPct).toBe(0);
    expect(c.counterfactualUsd).toBe(0);
  });
});
