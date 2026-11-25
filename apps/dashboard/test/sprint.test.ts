import { resolvePricing, totalPromptTokens } from "@ai-finops/interceptor";
import { createRouter } from "@ai-finops/router";
import { describe, expect, it } from "vitest";
import { FEATURE_SPAN_MS, LOOP_PROMPT, generateSprint } from "../src/lib/sprint";
import type { SprintOptions } from "../src/lib/sprint";

const START = Date.parse("2026-11-03T09:00:00.000Z");
const base: SprintOptions = { seed: 42, sprintIndex: 0, startMs: START, features: 4 };
const router = createRouter();

describe("generateSprint", () => {
  it("is deterministic: the same options give the same timeline, different seeds do not", () => {
    expect(generateSprint(base)).toEqual(generateSprint(base));
    expect(generateSprint({ ...base, seed: 43 })).not.toEqual(generateSprint(base));
  });

  it("returns items in time order with unique ids and timestamps that match atMs", () => {
    const items = generateSprint(base);
    expect(items.length).toBeGreaterThan(40);
    for (let i = 1; i < items.length; i += 1) expect(items[i]?.atMs ?? 0).toBeGreaterThanOrEqual(items[i - 1]?.atMs ?? 0);
    expect(new Set(items.map((i) => i.task.id)).size).toBe(items.length);
    expect(items.every((i) => i.task.timestamp === new Date(i.atMs).toISOString())).toBe(true);
  });

  it("keeps every item inside the sprint's time span", () => {
    const items = generateSprint(base);
    expect(items.every((i) => i.atMs >= START && i.atMs <= START + base.features * FEATURE_SPAN_MS + 60_000)).toBe(true);
  });

  it("is routed exactly as its author intended: scripted tasks are offloaded, model tasks reach the LLM", () => {
    for (const item of generateSprint({ ...base, loopOnFeature: 1 })) {
      const decision = router.route(item.task);
      expect(decision.route, `${item.task.id}: ${item.task.prompt}`).toBe(item.intent);
    }
  });

  it("uses all four subagents, each with model calls and scripted work", () => {
    const items = generateSprint(base);
    for (const agent of ["PM_Agent", "Architect_Agent", "Security_Agent", "Release_Agent"] as const) {
      expect(items.filter((i) => i.task.agent === agent && i.intent === "llm").length, `${agent} llm`).toBeGreaterThan(0);
      expect(items.filter((i) => i.task.agent === agent && i.intent === "script").length, `${agent} script`).toBeGreaterThan(0);
    }
  });

  it("exercises every deterministic rule", () => {
    const rules = new Set<string>();
    for (const item of generateSprint(base)) {
      const decision = router.route(item.task);
      if (decision.route === "script") rules.add(decision.ruleId);
    }
    expect([...rules].sort()).toEqual(["grep-search", "json-format", "lint-check", "test-summary"]);
  });

  it("ships each feature exactly once, on distinct feature ids", () => {
    const shipped = generateSprint(base).filter((i) => i.llm.milestone === "feature_shipped");
    expect(shipped).toHaveLength(4);
    expect(new Set(shipped.map((i) => i.llm.featureId)).size).toBe(4);
  });

  it("prices every task against a model the interceptor knows, with valid integer usage", () => {
    for (const item of generateSprint(base)) {
      expect(resolvePricing(item.task.model), item.task.model).toBeDefined();
      for (const n of Object.values(item.llm.usage)) expect(Number.isSafeInteger(n) && n >= 0).toBe(true);
    }
  });

  it("looks like a real agent loop: prompt caching dominates the prompt (>= 80% cache reads)", () => {
    const llm = generateSprint(base).filter((i) => i.intent === "llm");
    const reads = llm.reduce((s, i) => s + i.llm.usage.cacheReadTokens, 0);
    const prompt = llm.reduce((s, i) => s + totalPromptTokens(i.llm.usage), 0);
    expect(reads / prompt).toBeGreaterThanOrEqual(0.8);
  });

  it("carries the avoided call's re-read context on scripted tasks", () => {
    const scripted = generateSprint(base).filter((i) => i.intent === "script");
    expect(scripted.every((i) => (i.task.contextTokens ?? 0) >= 30_000)).toBe(true);
  });

  it("injects a Security_Agent retry loop only when asked: identical requests, seconds apart", () => {
    expect(generateSprint(base).some((i) => i.task.prompt === LOOP_PROMPT)).toBe(false);
    const loop = generateSprint({ ...base, loopOnFeature: 1 }).filter((i) => i.task.prompt === LOOP_PROMPT);
    expect(loop.length).toBeGreaterThanOrEqual(8);
    expect(loop.every((i) => i.task.agent === "Security_Agent" && i.intent === "llm")).toBe(true);
    for (let i = 1; i < loop.length; i += 1) expect((loop[i]?.atMs ?? 0) - (loop[i - 1]?.atMs ?? 0)).toBeLessThanOrEqual(30_000);
  });

  it("gives separate sprints separate ids so timelines can be concatenated", () => {
    const a = generateSprint(base);
    const b = generateSprint({ ...base, sprintIndex: 1, startMs: START + 3_600_000 });
    const ids = new Set([...a, ...b].map((i) => i.task.id));
    expect(ids.size).toBe(a.length + b.length);
    expect(a.every((i) => i.sessionId === "sprint-0")).toBe(true);
    expect(b.every((i) => i.sessionId === "sprint-1")).toBe(true);
  });
});
