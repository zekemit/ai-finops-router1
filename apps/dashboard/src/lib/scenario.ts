/** The seeded story the dashboard opens with: three finished sprints, one with a caught runaway loop. */
import { EMPTY_ENGINE, applyItem } from "./engine";
import type { EngineState } from "./engine";
import { FEATURE_SPAN_MS, generateSprint } from "./sprint";
import type { SimItem } from "./sprint";

export const SIM_EPOCH_MS = Date.parse("2026-11-03T09:00:00.000Z");
export const HISTORY_SPRINTS = 3;
export const FEATURES_PER_SPRINT = 4;
/** Sprints run back to back with a ten-minute gap, so the spend chart reads as one continuous timeline. */
const SPRINT_STRIDE_MS = FEATURES_PER_SPRINT * FEATURE_SPAN_MS + 10 * 60_000;

export const sprintStart = (sprintIndex: number): number => SIM_EPOCH_MS + sprintIndex * SPRINT_STRIDE_MS;

export function historyTimeline(seed: number): SimItem[] {
  const items: SimItem[] = [];
  for (let sprintIndex = 0; sprintIndex < HISTORY_SPRINTS; sprintIndex += 1) {
    items.push(
      ...generateSprint({
        seed,
        sprintIndex,
        startMs: sprintStart(sprintIndex),
        features: FEATURES_PER_SPRINT,
        ...(sprintIndex === 1 ? { loopOnFeature: 2 } : {}),
      }),
    );
  }
  return items.sort((a, b) => a.atMs - b.atMs);
}

/** A live sprint always includes a Security_Agent loop on its third feature, so the demo has its moment. */
export function liveSprintTimeline(seed: number, sprintIndex: number): SimItem[] {
  return generateSprint({ seed, sprintIndex, startMs: sprintStart(sprintIndex), features: FEATURES_PER_SPRINT, loopOnFeature: 2 });
}

export function seedEngine(seed: number): EngineState {
  return historyTimeline(seed).reduce<EngineState>((state, item) => applyItem(state, item), EMPTY_ENGINE);
}
