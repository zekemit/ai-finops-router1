import { summarize } from "@ai-finops/interceptor";
import { describe, expect, it } from "vitest";
import { DEFAULT_SPEED, initialPlayback, playbackReducer } from "../src/lib/playback";
import type { PlaybackState } from "../src/lib/playback";
import { HISTORY_SPRINTS, sprintStart } from "../src/lib/scenario";

const started = (seed = 42): PlaybackState => playbackReducer(initialPlayback(seed), { type: "start" });
const finish = (state: PlaybackState): PlaybackState => playbackReducer(state, { type: "tick", realMs: 1e9 });
const shipped = (state: PlaybackState): number => summarize(state.engine.events).featuresShipped;

describe("initial state", () => {
  it("opens with three sprints of history already played, idle, at the default speed", () => {
    const state = initialPlayback(42);
    expect(state.status).toBe("idle");
    expect(state.speed).toBe(DEFAULT_SPEED);
    expect(shipped(state)).toBe(12);
    expect(state.cursor).toBe(0);
    expect(state.timeline).toEqual([]);
  });
});

describe("starting a sprint", () => {
  it("loads a live sprint after the history and runs, without applying anything yet", () => {
    const state = started();
    expect(state.status).toBe("running");
    expect(state.timeline.length).toBeGreaterThan(40);
    expect(state.clockMs).toBe(sprintStart(HISTORY_SPRINTS));
    expect(state.engine.interceptedCalls).toBe(initialPlayback(42).engine.interceptedCalls);
  });

  it("ignores a second start while running", () => {
    const state = started();
    expect(playbackReducer(state, { type: "start" })).toBe(state);
  });
});

describe("tick", () => {
  it("advances simulated time by real time x speed and applies exactly the tasks that have come due", () => {
    const state = started();
    const next = playbackReducer(state, { type: "tick", realMs: 1_000 });
    const clock = sprintStart(HISTORY_SPRINTS) + 1_000 * DEFAULT_SPEED;
    expect(next.clockMs).toBe(clock);
    const due = state.timeline.filter((i) => i.atMs <= clock).length;
    expect(next.cursor).toBe(due);
    expect(next.engine.interceptedCalls).toBe(state.engine.interceptedCalls + due);
  });

  it("does nothing unless a sprint is running", () => {
    const idle = initialPlayback(42);
    expect(playbackReducer(idle, { type: "tick", realMs: 5_000 })).toBe(idle);
    const paused = playbackReducer(started(), { type: "pause" });
    expect(playbackReducer(paused, { type: "tick", realMs: 5_000 })).toBe(paused);
  });

  it("a faster speed applies more of the sprint in the same real time", () => {
    const slow = playbackReducer(playbackReducer(started(), { type: "setSpeed", speed: 8 }), { type: "tick", realMs: 3_000 });
    const fast = playbackReducer(playbackReducer(started(), { type: "setSpeed", speed: 128 }), { type: "tick", realMs: 3_000 });
    expect(fast.cursor).toBeGreaterThan(slow.cursor);
  });

  it("finishes the sprint: every task applied, four more features shipped, the live loop caught", () => {
    const before = initialPlayback(42);
    const done = finish(started());
    expect(done.status).toBe("done");
    expect(done.cursor).toBe(done.timeline.length);
    expect(done.engine.interceptedCalls).toBe(before.engine.interceptedCalls + done.timeline.length);
    expect(shipped(done)).toBe(16);
    expect(done.engine.loopAlerts.length).toBe(before.engine.loopAlerts.length + 1);
    expect(done.engine.prevented.calls).toBeGreaterThan(before.engine.prevented.calls);
  });
});

describe("pause, resume and speed", () => {
  it("pause freezes progress and resume continues from where it stopped", () => {
    const mid = playbackReducer(started(), { type: "tick", realMs: 2_000 });
    const paused = playbackReducer(mid, { type: "pause" });
    expect(paused.status).toBe("paused");
    const resumed = playbackReducer(paused, { type: "resume" });
    expect(resumed.status).toBe("running");
    expect(resumed.cursor).toBe(mid.cursor);
    expect(playbackReducer(resumed, { type: "tick", realMs: 2_000 }).cursor).toBeGreaterThan(mid.cursor);
  });

  it("start on a paused sprint resumes it", () => {
    const paused = playbackReducer(started(), { type: "pause" });
    expect(playbackReducer(paused, { type: "start" }).status).toBe("running");
  });

  it("rejects a nonsensical speed", () => {
    const state = started();
    for (const speed of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(playbackReducer(state, { type: "setSpeed", speed }).speed).toBe(DEFAULT_SPEED);
    }
  });
});

describe("running again", () => {
  it("a second sprint gets fresh task ids and ships four more features", () => {
    const first = finish(started());
    const second = finish(playbackReducer(first, { type: "start" }));
    const firstIds = new Set(first.timeline.map((i) => i.task.id));
    expect(second.timeline.some((i) => firstIds.has(i.task.id))).toBe(false);
    expect(shipped(second)).toBe(20);
    expect(second.status).toBe("done");
  });
});

describe("reseed and reset", () => {
  it("reseed rebuilds the history from a new seed and keeps the chosen speed", () => {
    const fast = playbackReducer(started(), { type: "setSpeed", speed: 128 });
    const next = playbackReducer(fast, { type: "reseed", seed: 7 });
    expect(next.seed).toBe(7);
    expect(next.status).toBe("idle");
    expect(next.speed).toBe(128);
    expect(next.engine).toEqual(initialPlayback(7).engine);
  });

  it("reset returns to the opening state for the same seed", () => {
    const mid = playbackReducer(started(), { type: "tick", realMs: 4_000 });
    expect(playbackReducer(mid, { type: "reset" })).toEqual({ ...initialPlayback(42), speed: mid.speed });
  });
});
