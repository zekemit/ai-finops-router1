import { describe, expect, it } from "vitest";
import { EMPTY_ENGINE, FEED_LIMIT, applyItem } from "../src/lib/engine";
import type { EngineState } from "../src/lib/engine";
import type { SimItem } from "../src/lib/sprint";
import { LOOP_PROMPT } from "../src/lib/sprint";
import { T0, llmItem, scriptItem } from "./helpers";

const run = (items: readonly SimItem[], from: EngineState = EMPTY_ENGINE): EngineState => items.reduce(applyItem, from);
const loopItem = (i: number, session = "sprint-9") =>
  llmItem({ id: `loop-${session}-${i}`, atMs: T0 + i * 8_000, prompt: LOOP_PROMPT, session });

describe("applyItem — a task that needs the model", () => {
  const item = llmItem({ id: "d1", atMs: T0, prompt: "Design the architecture", agent: "Architect_Agent", featureId: "S0-F1", milestone: "feature_shipped", latencyMs: 2_500 });
  const state = run([item]);

  it("becomes a billed telemetry event with the simulated usage, completed after its latency", () => {
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      id: "d1",
      agent: "Architect_Agent",
      model: "claude-sonnet-5-5",
      sessionId: "sprint-9",
      source: "simulator",
      featureId: "S0-F1",
      milestone: "feature_shipped",
      latencyMs: 2_500,
      timestamp: new Date(T0 + 2_500).toISOString(),
    });
    expect(state.events[0]?.usage.outputTokens).toBe(1_000_000);
    expect(state.events[0]?.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it("counts the intercepted call, advances the clock, and adds a feed entry priced at the call's cost", () => {
    expect(state.interceptedCalls).toBe(1);
    expect(state.clockMs).toBe(T0);
    expect(state.offloads).toEqual([]);
    expect(state.feed[0]).toMatchObject({ kind: "llm", agent: "Architect_Agent", usd: 10 });
    expect(state.feed[0]?.title).toContain("Design the architecture");
  });
});

describe("applyItem — a task the router answers with a script", () => {
  const state = run([scriptItem({ id: "s1", atMs: T0, contextTokens: 20_000 })]);

  it("logs the savings record, bills nothing, and still counts the intercepted call", () => {
    expect(state.events).toEqual([]);
    expect(state.offloads).toHaveLength(1);
    expect(state.offloads[0]).toMatchObject({ task_id: "s1", rule_id: "json-format", agent: "PM_Agent" });
    expect(state.interceptedCalls).toBe(1);
  });

  it("shows the win in the feed with the dollars saved", () => {
    const record = state.offloads[0];
    expect(state.feed[0]).toMatchObject({ kind: "offload", ruleId: "json-format", usd: record?.offloaded_savings_usd });
    expect((record?.offloaded_savings_usd ?? 0)).toBeGreaterThan(0);
  });

  it("counts only fresh tokens as avoided (prompt, attached data, answer), not cached context the call would merely have re-read", () => {
    const record = state.offloads[0];
    expect(record?.avoided_cache_read_tokens).toBe(20_000);
    expect(state.feed[0]?.tokens).toBe((record?.avoided_input_tokens ?? 0) + (record?.avoided_output_tokens ?? 0));
    expect(state.feed[0]?.tokens).toBeLessThan(record?.avoided_tokens ?? 0);
  });
});

describe("applyItem — purity", () => {
  it("never mutates the previous state and is repeatable", () => {
    const first = run([llmItem({ id: "a", atMs: T0 }), scriptItem({ id: "b", atMs: T0 + 1_000 })]);
    const snapshot = JSON.stringify(first);
    const next = applyItem(first, llmItem({ id: "c", atMs: T0 + 2_000 }));
    expect(JSON.stringify(first)).toBe(snapshot);
    expect(next).not.toBe(first);
    const again = run([llmItem({ id: "a", atMs: T0 }), scriptItem({ id: "b", atMs: T0 + 1_000 }), llmItem({ id: "c", atMs: T0 + 2_000 })]);
    expect(again).toEqual(next);
  });

  it("keeps the feed to the newest 40 entries, newest first", () => {
    const items = Array.from({ length: 60 }, (_, i) => llmItem({ id: `x${i}`, atMs: T0 + i * 1_000 }));
    const state = run(items);
    expect(state.feed).toHaveLength(FEED_LIMIT);
    expect(state.feed[0]?.id).toBe("x59");
    expect(state.feed[FEED_LIMIT - 1]?.id).toBe("x20");
    expect(state.events).toHaveLength(60);
  });
});

describe("applyItem — runaway-loop circuit breaker", () => {
  it("raises an alert on the 4th identical call, pricing the waste as the 3 repeats after the first", () => {
    const state = run([1, 2, 3, 4].map((i) => loopItem(i)));
    expect(state.loopAlerts).toHaveLength(1);
    expect(state.loopAlerts[0]).toMatchObject({ agent: "Security_Agent", sessionId: "sprint-9", repeats: 4, wastedCostUsd: 30 });
    expect(state.feed[0]).toMatchObject({ kind: "loop", agent: "Security_Agent", usd: 30, repeats: 4 });
  });

  it("does not alert before the threshold", () => {
    expect(run([1, 2, 3].map((i) => loopItem(i))).loopAlerts).toEqual([]);
  });

  it("then blocks further repeats: they are never billed, and the avoided cost is recorded", () => {
    const state = run([1, 2, 3, 4, 5, 6].map((i) => loopItem(i)));
    expect(state.events).toHaveLength(4);
    expect(state.loopAlerts).toHaveLength(1);
    expect(state.prevented).toEqual({ calls: 2, usd: 20 });
    expect(state.interceptedCalls).toBe(6);
    expect(state.feed[0]).toMatchObject({ kind: "blocked", usd: 10 });
  });

  it("is scoped to one session: the same request in another sprint is not blocked", () => {
    const state = run([1, 2, 3, 4, 5].map((i) => loopItem(i, "sprint-A")));
    const after = run([1, 2, 3].map((i) => loopItem(i + 100, "sprint-B")), state);
    expect(after.events.filter((e) => e.sessionId === "sprint-B")).toHaveLength(3);
    expect(after.prevented.calls).toBe(1); // only sprint-A's 5th
  });

  it("treats different requests by the same agent as progress, not a loop", () => {
    const items = Array.from({ length: 8 }, (_, i) => llmItem({ id: `p${i}`, atMs: T0 + i * 8_000, prompt: `Review change ${i}`, agent: "Security_Agent" }));
    const state = run(items);
    expect(state.loopAlerts).toEqual([]);
    expect(state.events).toHaveLength(8);
  });
});
