import { describe, expect, it } from "vitest";
import { computeBurnRate, detectRunawayLoops } from "../src/analytics";
import { makeEvent } from "./helpers";

// 1M output tokens on sonnet-5-5 = exactly $10 per event: easy to reason about.
const tenDollar = { outputTokens: 1_000_000 };
const NOW = Date.parse("2026-11-25T10:10:00.000Z");
const iso = (hms: string): string => `2026-11-25T${hms}.000Z`;

describe("computeBurnRate", () => {
  it("scales window spend to dollars per minute and counts only events inside (now - window, now]", () => {
    const events = [
      makeEvent({ agent: "PM_Agent", timestamp: iso("10:09:30"), usage: tenDollar }), // in
      makeEvent({ agent: "Architect_Agent", timestamp: iso("10:09:50"), usage: tenDollar }), // in
      makeEvent({ agent: "PM_Agent", timestamp: iso("10:08:00"), usage: tenDollar }), // too old
      makeEvent({ agent: "PM_Agent", timestamp: iso("10:09:00"), usage: tenDollar }), // exactly now-60s: excluded
      makeEvent({ agent: "PM_Agent", timestamp: iso("10:10:05"), usage: tenDollar }), // in the future: excluded
    ];
    const rate = computeBurnRate(events, NOW, { windowMs: 60_000 });
    expect(rate.costUsdPerMinute).toBe(20);
    expect(rate.tokensPerMinute).toBe(2_000_000);
    expect(rate.activeAgents).toEqual(["PM_Agent", "Architect_Agent"]);
    expect(rate.byAgent).toEqual([
      { agent: "PM_Agent", costUsdPerMinute: 10 },
      { agent: "Architect_Agent", costUsdPerMinute: 10 },
    ]);
  });

  it("normalises a longer window back to per-minute", () => {
    const events = [
      makeEvent({ timestamp: iso("10:09:30"), usage: tenDollar }),
      makeEvent({ timestamp: iso("10:09:50"), usage: tenDollar }),
      makeEvent({ timestamp: iso("10:09:00"), usage: tenDollar }), // inside a 2-minute window
    ];
    expect(computeBurnRate(events, NOW, { windowMs: 120_000 }).costUsdPerMinute).toBe(15); // $30 over 2 min
  });

  it("is all zeros with no active agents when nothing happened in the window", () => {
    const rate = computeBurnRate([makeEvent({ timestamp: iso("09:00:00"), usage: tenDollar })], NOW);
    expect(rate).toMatchObject({ costUsdPerMinute: 0, tokensPerMinute: 0, activeAgents: [], byAgent: [] });
  });

  it("defaults to a 60-second window", () => {
    const rate = computeBurnRate([makeEvent({ timestamp: iso("10:09:30"), usage: tenDollar })], NOW);
    expect(rate.windowMs).toBe(60_000);
    expect(rate.costUsdPerMinute).toBe(10);
  });

  it("counts tokens but not dollars for models it cannot price", () => {
    const rate = computeBurnRate(
      [makeEvent({ timestamp: iso("10:09:30"), model: "mystery", usage: { outputTokens: 500 } })],
      NOW,
    );
    expect(rate.costUsdPerMinute).toBe(0);
    expect(rate.tokensPerMinute).toBe(500);
  });
});

describe("detectRunawayLoops", () => {
  const loopEvents = (n: number, over: { agent?: "Security_Agent" | "PM_Agent"; fingerprint?: string; gapSeconds?: number; session?: string } = {}) =>
    Array.from({ length: n }, (_, i) =>
      makeEvent({
        agent: over.agent ?? "Security_Agent",
        sessionId: over.session ?? "s1",
        fingerprint: over.fingerprint ?? "f1",
        timestamp: new Date(Date.parse("2026-11-25T10:00:00.000Z") + i * (over.gapSeconds ?? 10) * 1000).toISOString(),
        usage: tenDollar,
      }),
    );

  it("flags an agent repeating the identical call and prices the waste as every repeat after the first", () => {
    const alerts = detectRunawayLoops(loopEvents(5));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toEqual({
      agent: "Security_Agent",
      sessionId: "s1",
      fingerprint: "f1",
      repeats: 5,
      firstTimestamp: "2026-11-25T10:00:00.000Z",
      lastTimestamp: "2026-11-25T10:00:40.000Z",
      wastedCostUsd: 40,
      wastedTokens: 4_000_000,
    });
  });

  it("does not flag fewer repeats than the threshold (default 4)", () => {
    expect(detectRunawayLoops(loopEvents(3))).toEqual([]);
    expect(detectRunawayLoops(loopEvents(4))).toHaveLength(1);
  });

  it("honours a custom threshold", () => {
    expect(detectRunawayLoops(loopEvents(3), { minRepeats: 3 })).toHaveLength(1);
  });

  it("splits a run when the gap between repeats exceeds the window", () => {
    // 5 calls, 150s apart, default window 120s: every gap breaks the run.
    expect(detectRunawayLoops(loopEvents(5, { gapSeconds: 150 }))).toEqual([]);
    expect(detectRunawayLoops(loopEvents(5, { gapSeconds: 150 }), { windowMs: 200_000 })).toHaveLength(1);
  });

  it("does not let a different agent's identical call extend the run", () => {
    const a = loopEvents(3, { agent: "Security_Agent" });
    const b = loopEvents(3, { agent: "PM_Agent" }); // same fingerprint, same times, other agent
    expect(detectRunawayLoops([...a, ...b])).toEqual([]);
  });

  it("does not merge repeats across sessions", () => {
    expect(detectRunawayLoops([...loopEvents(3, { session: "s1" }), ...loopEvents(3, { session: "s2" })])).toEqual([]);
  });

  it("treats a different call by the same agent as progress that breaks the run", () => {
    const events = [
      ...loopEvents(2, { fingerprint: "f1" }),
      makeEvent({ agent: "Security_Agent", sessionId: "s1", fingerprint: "f2", timestamp: "2026-11-25T10:00:15.000Z" }),
      ...loopEvents(2, { fingerprint: "f1" }).map((e, i) =>
        makeEvent({ ...e, id: `late-${i}`, timestamp: `2026-11-25T10:00:${20 + i * 10}.000Z`, usage: tenDollar }),
      ),
    ];
    expect(detectRunawayLoops(events)).toEqual([]);
    expect(detectRunawayLoops(events, { minRepeats: 2 })).toHaveLength(2);
  });

  it("ignores events without a fingerprint rather than letting them break a run", () => {
    const events = [
      ...loopEvents(2),
      makeEvent({ agent: "Security_Agent", sessionId: "s1", timestamp: "2026-11-25T10:00:15.000Z" }), // text-only call
      ...loopEvents(4).slice(2).map((e, i) => makeEvent({ ...e, id: `x-${i}` })),
    ];
    expect(detectRunawayLoops(events)).toHaveLength(1);
  });

  it("reports multiple loops ordered by when they started", () => {
    const first = loopEvents(4, { fingerprint: "fa" });
    const second = loopEvents(4, { fingerprint: "fb", agent: "PM_Agent" }).map((e, i) =>
      makeEvent({ ...e, id: `b-${i}`, timestamp: new Date(Date.parse(e.timestamp) + 3_600_000).toISOString() }),
    );
    const alerts = detectRunawayLoops([...second, ...first]);
    expect(alerts.map((a) => a.fingerprint)).toEqual(["fa", "fb"]);
  });

  it("counts waste in tokens even for models it cannot price", () => {
    const events = loopEvents(4).map((e, i) => makeEvent({ ...e, id: `m-${i}`, model: "mystery", usage: { outputTokens: 100 } }));
    const [alert] = detectRunawayLoops(events);
    expect(alert?.wastedCostUsd).toBe(0);
    expect(alert?.wastedTokens).toBe(300);
  });
});
