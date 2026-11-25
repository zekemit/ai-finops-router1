import { costOfEvent, parseClaudeCodeJsonl, resolvePricing } from "@ai-finops/interceptor";
import { createRouter } from "@ai-finops/router";
import { describe, expect, it } from "vitest";
import { generateStream } from "../src/lib/logstream";
import type { StreamStep } from "../src/lib/logstream";

type LineStep = Extract<StreamStep, { kind: "line" }>;
type TaskStep = Extract<StreamStep, { kind: "task" }>;
const lineSteps = (steps: readonly StreamStep[]): LineStep[] => steps.filter((s): s is LineStep => s.kind === "line");
const taskSteps = (steps: readonly StreamStep[]): TaskStep[] => steps.filter((s): s is TaskStep => s.kind === "task");

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group === undefined) groups.set(k, [item]);
    else group.push(item);
  }
  return groups;
}

interface RawLine {
  type: string;
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  requestId: string;
  timestamp: string;
  message: { id: string; model: string; content: { type: string }[]; usage: Record<string, unknown> & { cache_creation: Record<string, number>; cache_creation_input_tokens: number } };
}
const raw = (step: LineStep): RawLine => JSON.parse(step.line) as RawLine;

describe("generateStream — determinism", () => {
  it("is identical for the same seed and different for another", () => {
    expect(generateStream(42, 24)).toEqual(generateStream(42, 24));
    expect(generateStream(43, 24)).not.toEqual(generateStream(42, 24));
  });

  it("produces exactly the requested number of calls", () => {
    expect(new Set(lineSteps(generateStream(7, 30)).map((s) => s.callIndex)).size).toBe(30);
  });
});

describe("generateStream — it looks like a real Claude Code log, and the real parser agrees", () => {
  const steps = generateStream(42, 24);
  const lines = lineSteps(steps);
  const result = parseClaudeCodeJsonl(lines.map((s) => s.line).join("\n"));

  it("parses with zero warnings", () => {
    expect(result.warnings).toEqual([]);
  });

  it("writes one line per content block, so the raw line count exceeds the billed-call count", () => {
    expect(lines.length).toBeGreaterThan(24);
    expect(result.stats.recordsRead).toBe(lines.length);
  });

  it("collapses to exactly the requested calls once de-duplicated on message.id + requestId", () => {
    expect(result.events).toHaveLength(24);
    expect(result.stats.duplicatesDropped).toBe(lines.length - 24);
  });

  it("gives each call between one and four blocks, numbered in order, with some multi-block calls", () => {
    const byCall = groupBy(lines, (s) => s.callIndex);
    for (const [, blocks] of byCall) {
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      expect(blocks.length).toBeLessThanOrEqual(4);
      expect(blocks.map((b) => b.blockIndex)).toEqual(blocks.map((_, i) => i));
      expect(blocks.every((b) => b.blockCount === blocks.length)).toBe(true);
    }
    expect(Math.max(...[...byCall.values()].map((b) => b.length))).toBeGreaterThanOrEqual(3);
  });

  it("repeats the identical usage and ids on every block of a call, with fresh ids per call", () => {
    const byCall = groupBy(lines, (s) => s.callIndex);
    const messageIds = new Set<string>();
    for (const [, blocks] of byCall) {
      const parsed = blocks.map(raw);
      const first = parsed[0];
      expect(parsed.every((p) => p.message.id === first?.message.id && p.requestId === first?.requestId)).toBe(true);
      expect(parsed.every((p) => JSON.stringify(p.message.usage) === JSON.stringify(first?.message.usage))).toBe(true);
      messageIds.add(first?.message.id ?? "");
    }
    expect(messageIds.size).toBe(24);
  });

  it("splits cache writes into the 5m and 1h tiers the way real logs do", () => {
    for (const s of lines) {
      const { cache_creation: tiers, cache_creation_input_tokens: total } = raw(s).message.usage;
      expect((tiers.ephemeral_5m_input_tokens ?? 0) + (tiers.ephemeral_1h_input_tokens ?? 0)).toBe(total);
    }
  });

  it("chains lines by parentUuid and timestamps them in order, matching atMs", () => {
    const uuids = lines.map((s) => raw(s).uuid);
    expect(new Set(uuids).size).toBe(lines.length);
    lines.forEach((s, i) => {
      const parsed = raw(s);
      expect(parsed.parentUuid).toBe(i === 0 ? null : uuids[i - 1]);
      expect(parsed.timestamp).toBe(new Date(s.atMs).toISOString());
      if (i > 0) expect(s.atMs).toBeGreaterThanOrEqual(lines[i - 1]?.atMs ?? 0);
    });
  });

  it("reads like a prompt-cached agent loop: at least 85% of prompt tokens come from cache", () => {
    const reads = result.events.reduce((s, e) => s + e.usage.cacheReadTokens, 0);
    const prompt = result.events.reduce((s, e) => s + e.usage.inputTokens + e.usage.cacheReadTokens + e.usage.cacheWrite5mTokens + e.usage.cacheWrite1hTokens, 0);
    expect(reads / prompt).toBeGreaterThanOrEqual(0.85);
  });

  it("uses only models the interceptor can price", () => {
    for (const e of result.events) expect(resolvePricing(e.model), e.model).toBeDefined();
    expect(result.events.every((e) => costOfEvent(e) !== undefined)).toBe(true);
  });
});

describe("generateStream — mechanical tasks for the real router", () => {
  const router = createRouter();
  const steps = generateStream(42, 60);
  const tasks = taskSteps(steps);

  it("interleaves tasks, each answered by a script (the model is never needed)", () => {
    expect(tasks.length).toBeGreaterThan(10);
    for (const t of tasks) {
      const decision = router.route(t.task);
      expect(decision.route, t.task.prompt).toBe("script");
      if (decision.route === "script") expect(decision.record.offloaded_savings_usd).toBeGreaterThan(0);
    }
  });

  it("covers all four deterministic rules over a long enough stream", () => {
    const rules = new Set(tasks.map((t) => { const d = router.route(t.task); return d.route === "script" ? d.ruleId : "llm"; }));
    expect([...rules].sort()).toEqual(["grep-search", "json-format", "lint-check", "test-summary"]);
  });

  it("gives tasks unique ids, ordered timestamps and a realistic re-read context", () => {
    expect(new Set(tasks.map((t) => t.task.id)).size).toBe(tasks.length);
    expect(tasks.every((t) => (t.task.contextTokens ?? 0) >= 30_000)).toBe(true);
    expect(tasks.every((t) => t.task.timestamp === new Date(t.atMs).toISOString())).toBe(true);
    for (let i = 1; i < steps.length; i += 1) expect(steps[i]?.atMs ?? 0).toBeGreaterThanOrEqual(steps[i - 1]?.atMs ?? 0);
  });
});
