/** Playback of a live sprint over the engine: a pure reducer, so the whole demo is testable without a browser. */
import { applyItem } from "./engine";
import type { EngineState } from "./engine";
import { HISTORY_SPRINTS, liveSprintTimeline, seedEngine, sprintStart } from "./scenario";
import type { SimItem } from "./sprint";

export const SPEEDS = [8, 32, 128] as const;
export const DEFAULT_SPEED = 32;

export type PlaybackStatus = "idle" | "running" | "paused" | "done";

export interface PlaybackState {
  readonly seed: number;
  readonly engine: EngineState;
  readonly status: PlaybackStatus;
  /** Simulated seconds per real second. */
  readonly speed: number;
  /** Index of the next sprint to run. */
  readonly sprintIndex: number;
  readonly timeline: readonly SimItem[];
  readonly cursor: number;
  /** Simulated "now" while streaming. */
  readonly clockMs: number;
}

export type PlaybackAction =
  | { readonly type: "start" }
  | { readonly type: "pause" }
  | { readonly type: "resume" }
  | { readonly type: "tick"; readonly realMs: number }
  | { readonly type: "setSpeed"; readonly speed: number }
  | { readonly type: "reseed"; readonly seed: number }
  | { readonly type: "reset" };

export function initialPlayback(seed: number): PlaybackState {
  const engine = seedEngine(seed);
  return { seed, engine, status: "idle", speed: DEFAULT_SPEED, sprintIndex: HISTORY_SPRINTS, timeline: [], cursor: 0, clockMs: engine.clockMs };
}

export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case "start": {
      if (state.status === "running") return state;
      if (state.status === "paused") return { ...state, status: "running" };
      return {
        ...state,
        status: "running",
        timeline: liveSprintTimeline(state.seed, state.sprintIndex),
        cursor: 0,
        clockMs: sprintStart(state.sprintIndex),
        sprintIndex: state.sprintIndex + 1,
      };
    }
    case "pause":
      return state.status === "running" ? { ...state, status: "paused" } : state;
    case "resume":
      return state.status === "paused" ? { ...state, status: "running" } : state;
    case "tick": {
      if (state.status !== "running" || !(action.realMs > 0)) return state;
      const clockMs = state.clockMs + action.realMs * state.speed;
      let { engine, cursor } = state;
      while (cursor < state.timeline.length) {
        const item = state.timeline[cursor];
        if (item === undefined || item.atMs > clockMs) break;
        engine = applyItem(engine, item);
        cursor += 1;
      }
      return { ...state, engine, cursor, clockMs, status: cursor >= state.timeline.length ? "done" : "running" };
    }
    case "setSpeed":
      return Number.isFinite(action.speed) && action.speed > 0 ? { ...state, speed: action.speed } : state;
    case "reseed":
      return { ...initialPlayback(action.seed), speed: state.speed };
    case "reset":
      return { ...initialPlayback(state.seed), speed: state.speed };
  }
}
