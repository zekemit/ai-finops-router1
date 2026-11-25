/**
 * Plays the stream through the real interceptor parser and the real router, one step at a time.
 *
 * Every verdict on screen comes from those packages: a line is "new" or "dup" by the call key the parser derives
 * (`message.id|requestId`), costs come from the interceptor's price table, and scripted answers and their savings
 * come from the router's own records. Pure: `advance` returns a new state and reads no clock.
 */
import { costOfEvent, parseClaudeCodeJsonl } from "@ai-finops/interceptor";
import { createRouter } from "@ai-finops/router";
import type { OffloadRecord } from "@ai-finops/router";
import type { StreamStep } from "./logstream";

export const FEED_CAP = 60;

export type RowKind = "new" | "dup" | "script";

export interface FeedRow {
  readonly id: string;
  readonly atMs: number;
  readonly kind: RowKind;
  /** `message.id|requestId` for log lines; the rule id for scripted tasks. */
  readonly key: string;
  readonly title: string;
  /** `2/3` for the second of three lines in a call; null for tasks. */
  readonly block: string | null;
  /** The log line exactly as written, for log rows; null for scripted tasks. */
  readonly raw: string | null;
  /** Billed: the call's cost for "new", $0 for "dup". For "script": dollars the avoided call would have cost. */
  readonly usd: number;
  /** What this line would have added had every line been summed. */
  readonly naiveUsd: number;
  readonly tokens: number;
}

export interface StreamStats {
  readonly rawLines: number;
  readonly uniqueCalls: number;
  readonly duplicatesCollapsed: number;
  readonly naiveUsd: number;
  readonly correctUsd: number;
  /** `naiveUsd / correctUsd`; null until something is billed. */
  readonly overcountFactor: number | null;
  /** Tokens the model actually processed, counting each call once. */
  readonly llmTokens: number;
  readonly tasksSeen: number;
  readonly offloaded: number;
  readonly savedUsd: number;
  /** Fresh tokens the scripts saved the model from reading or writing (excludes re-read cached context). */
  readonly avoidedTokens: number;
}

export interface StreamState {
  readonly steps: readonly StreamStep[];
  readonly cursor: number;
  readonly done: boolean;
  readonly seen: readonly string[];
  readonly records: readonly OffloadRecord[];
  /** Newest first, capped at FEED_CAP. */
  readonly rows: readonly FeedRow[];
  readonly stats: StreamStats;
}

const ZERO_STATS: StreamStats = {
  rawLines: 0,
  uniqueCalls: 0,
  duplicatesCollapsed: 0,
  naiveUsd: 0,
  correctUsd: 0,
  overcountFactor: null,
  llmTokens: 0,
  tasksSeen: 0,
  offloaded: 0,
  savedUsd: 0,
  avoidedTokens: 0,
};

const router = createRouter();

export function initialStream(steps: readonly StreamStep[]): StreamState {
  return { steps, cursor: 0, done: steps.length === 0, seen: [], records: [], rows: [], stats: ZERO_STATS };
}

const withFactor = (stats: StreamStats): StreamStats => ({ ...stats, overcountFactor: stats.correctUsd > 0 ? stats.naiveUsd / stats.correctUsd : null });
const pushRow = (rows: readonly FeedRow[], row: FeedRow): FeedRow[] => [row, ...rows].slice(0, FEED_CAP);

function applyStep(state: StreamState, step: StreamStep): StreamState {
  if (step.kind === "line") {
    const event = parseClaudeCodeJsonl(step.line).events[0];
    const cursor = state.cursor + 1;
    if (event === undefined) {
      return { ...state, cursor, done: cursor >= state.steps.length, stats: { ...state.stats, rawLines: state.stats.rawLines + 1 } };
    }
    const cost = costOfEvent(event)?.totalUsd ?? 0;
    const isNew = !state.seen.includes(event.id);
    const u = event.usage;
    const tokens = u.inputTokens + u.cacheReadTokens + u.cacheWrite5mTokens + u.cacheWrite1hTokens + u.outputTokens;
    const stats = withFactor({
      ...state.stats,
      rawLines: state.stats.rawLines + 1,
      naiveUsd: state.stats.naiveUsd + cost,
      uniqueCalls: state.stats.uniqueCalls + (isNew ? 1 : 0),
      duplicatesCollapsed: state.stats.duplicatesCollapsed + (isNew ? 0 : 1),
      correctUsd: state.stats.correctUsd + (isNew ? cost : 0),
      llmTokens: state.stats.llmTokens + (isNew ? tokens : 0),
    });
    return {
      ...state,
      cursor,
      done: cursor >= state.steps.length,
      seen: isNew ? [...state.seen, event.id] : state.seen,
      stats,
      rows: pushRow(state.rows, {
        id: `${event.id}#${step.blockIndex}`,
        atMs: step.atMs,
        kind: isNew ? "new" : "dup",
        key: event.id,
        title: event.model,
        block: `${step.blockIndex + 1}/${step.blockCount}`,
        raw: step.line,
        usd: isNew ? cost : 0,
        naiveUsd: cost,
        tokens: isNew ? tokens : 0,
      }),
    };
  }

  const cursor = state.cursor + 1;
  const decision = router.route(step.task);
  if (decision.route !== "script") {
    return { ...state, cursor, done: cursor >= state.steps.length, stats: { ...state.stats, tasksSeen: state.stats.tasksSeen + 1 } };
  }
  const { record } = decision;
  const fresh = record.avoided_input_tokens + record.avoided_output_tokens;
  return {
    ...state,
    cursor,
    done: cursor >= state.steps.length,
    records: [...state.records, record],
    stats: {
      ...state.stats,
      tasksSeen: state.stats.tasksSeen + 1,
      offloaded: state.stats.offloaded + 1,
      savedUsd: state.stats.savedUsd + record.offloaded_savings_usd,
      avoidedTokens: state.stats.avoidedTokens + fresh,
    },
    rows: pushRow(state.rows, {
      id: step.task.id,
      atMs: step.atMs,
      kind: "script",
      key: record.rule_id,
      title: step.task.prompt,
      block: null,
      raw: null,
      usd: record.offloaded_savings_usd,
      naiveUsd: 0,
      tokens: fresh,
    }),
  };
}

/** Apply the next `count` steps (default one). A finished stream is returned unchanged. */
export function advance(state: StreamState, count = 1): StreamState {
  if (state.done) return state;
  let next = state;
  for (let i = 0; i < count && !next.done; i += 1) {
    const step = next.steps[next.cursor];
    if (step === undefined) break;
    next = applyStep(next, step);
  }
  return next;
}
