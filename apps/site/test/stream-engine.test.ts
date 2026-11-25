import { costOfEvent, parseClaudeCodeJsonl, summarize } from "@ai-finops/interceptor";
import { describe, expect, it } from "vitest";
import { generateStream } from "../src/lib/logstream";
import type { StreamStep } from "../src/lib/logstream";
import { FEED_CAP, advance, initialStream } from "../src/lib/stream-engine";
import type { StreamState } from "../src/lib/stream-engine";

const CALLS = 24;
const steps = generateStream(42, CALLS);
const lineSteps = steps.filter((s): s is Extract<StreamStep, { kind: "line" }> => s.kind === "line");
const taskCount = steps.length - lineSteps.length;
const full = advance(initialStream(steps), steps.length);

describe("initialStream and advance", () => {
  it("starts at the first step with empty counters", () => {
    const s = initialStream(steps);
    expect(s.cursor).toBe(0);
    expect(s.done).toBe(false);
    expect(s.rows).toEqual([]);
    expect(s.stats).toMatchObject({ rawLines: 0, uniqueCalls: 0, duplicatesCollapsed: 0, naiveUsd: 0, correctUsd: 0, offloaded: 0, savedUsd: 0 });
  });

  it("applies exactly the number of steps asked for, one by default, and never past the end", () => {
    const s0 = initialStream(steps);
    expect(advance(s0).cursor).toBe(1);
    expect(advance(s0, 5).cursor).toBe(5);
    expect(advance(s0, 10_000).cursor).toBe(steps.length);
    expect(advance(s0, 10_000).done).toBe(true);
  });

  it("does nothing once finished, and never mutates the state it was given", () => {
    expect(advance(full)).toBe(full);
    const s0 = initialStream(steps);
    const snapshot = JSON.stringify(s0);
    advance(s0, 7);
    expect(JSON.stringify(s0)).toBe(snapshot);
  });
});

describe("the live counters agree with the real parser run on the whole log", () => {
  const batch = parseClaudeCodeJsonl(lineSteps.map((s) => s.line).join("\n"));

  it("counts raw lines, unique calls and collapsed duplicates", () => {
    expect(full.stats.rawLines).toBe(lineSteps.length);
    expect(full.stats.uniqueCalls).toBe(batch.events.length);
    expect(full.stats.uniqueCalls).toBe(CALLS);
    expect(full.stats.duplicatesCollapsed).toBe(batch.stats.duplicatesDropped);
    expect(full.stats.rawLines).toBe(full.stats.uniqueCalls + full.stats.duplicatesCollapsed);
  });

  it("bills the correct total exactly as the interceptor's summary does", () => {
    expect(full.stats.correctUsd).toBeCloseTo(summarize(batch.events).totalCostUsd, 12);
  });

  it("bills the naive total as every line priced separately: each call's cost times its number of lines", () => {
    const blocksOf = new Map<string, number>();
    for (const s of lineSteps) {
      const m = (JSON.parse(s.line) as { message: { id: string }; requestId: string });
      const key = `${m.message.id}|${m.requestId}`;
      blocksOf.set(key, (blocksOf.get(key) ?? 0) + 1);
    }
    const expected = batch.events.reduce((sum, e) => sum + (costOfEvent(e)?.totalUsd ?? 0) * (blocksOf.get(e.id) ?? 0), 0);
    expect(full.stats.naiveUsd).toBeCloseTo(expected, 12);
  });

  it("overstates spend when the lines are summed, by a factor that is the naive total over the correct one", () => {
    expect(full.stats.naiveUsd).toBeGreaterThan(full.stats.correctUsd);
    expect(full.stats.overcountFactor).toBeCloseTo(full.stats.naiveUsd / full.stats.correctUsd, 12);
    expect(full.stats.overcountFactor ?? 0).toBeGreaterThan(1.5);
  });

  it("has no overcount factor before anything is billed", () => {
    expect(initialStream(steps).stats.overcountFactor).toBeNull();
  });

  it("totals the tokens the model actually processed, once per call", () => {
    const expected = batch.events.reduce((s, e) => s + e.usage.inputTokens + e.usage.cacheReadTokens + e.usage.cacheWrite5mTokens + e.usage.cacheWrite1hTokens + e.usage.outputTokens, 0);
    expect(full.stats.llmTokens).toBe(expected);
  });
});

describe("the feed", () => {
  it("marks the first line of each call 'new' and every repeat 'dup', by the parser's own call key", () => {
    let state = initialStream(steps);
    for (const step of steps) {
      state = advance(state);
      const row = state.rows[0];
      if (step.kind === "task") expect(row?.kind).toBe("script");
      else expect(row?.kind, `call ${step.callIndex} block ${step.blockIndex}`).toBe(step.blockIndex === 0 ? "new" : "dup");
    }
  });

  it("prices a new call at its cost, a duplicate at $0 billed, and shows what each line would have cost naively", () => {
    let state = initialStream(steps);
    let sawDup = false;
    for (const step of steps) {
      state = advance(state);
      const row = state.rows[0];
      if (row?.kind === "dup") {
        sawDup = true;
        expect(row.usd).toBe(0);
        expect(row.naiveUsd).toBeGreaterThan(0);
      }
      if (row?.kind === "new") {
        expect(row.usd).toBeGreaterThan(0);
        expect(row.naiveUsd).toBeCloseTo(row.usd, 12);
      }
      void step;
    }
    expect(sawDup).toBe(true);
  });

  it("keeps the newest rows first and caps the list", () => {
    expect(full.rows.length).toBeLessThanOrEqual(FEED_CAP);
    expect(full.rows.length).toBe(Math.min(FEED_CAP, steps.length));
    expect(full.rows[0]?.atMs ?? 0).toBeGreaterThanOrEqual(full.rows[full.rows.length - 1]?.atMs ?? 0);
  });

  it("carries each log line's raw JSONL on its row, and nothing on a task's row", () => {
    let state = initialStream(steps);
    for (const step of steps) {
      state = advance(state);
      expect(state.rows[0]?.raw).toBe(step.kind === "line" ? step.line : null);
    }
  });

  it("gives every row a unique id", () => {
    expect(new Set(full.rows.map((r) => r.id)).size).toBe(full.rows.length);
  });
});

describe("scripted tasks", () => {
  it("count tasks seen, offloads, dollars saved and fresh tokens avoided from the router's own records", () => {
    expect(full.stats.tasksSeen).toBe(taskCount);
    expect(full.stats.offloaded).toBe(taskCount);
    expect(full.records).toHaveLength(taskCount);
    expect(full.stats.savedUsd).toBeCloseTo(full.records.reduce((s, r) => s + r.offloaded_savings_usd, 0), 12);
    expect(full.stats.avoidedTokens).toBe(full.records.reduce((s, r) => s + r.avoided_input_tokens + r.avoided_output_tokens, 0));
    expect(full.stats.savedUsd).toBeGreaterThan(0);
  });
});

describe("state is replayable", () => {
  it("reaches the same state by one big advance or many small ones", () => {
    let stepwise: StreamState = initialStream(steps);
    for (let i = 0; i < steps.length; i += 1) stepwise = advance(stepwise);
    expect(stepwise).toEqual(full);
  });
});
