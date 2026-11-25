/**
 * The simulation engine: every task a subagent issues is intercepted by the REAL router. Mechanical
 * tasks are answered by a local script (logging the avoided spend); the rest reach the "model", become
 * billed telemetry events, and are watched by the interceptor's loop detector. When a loop is caught,
 * a circuit breaker blocks the agent's further identical requests for that sprint.
 *
 * Pure: `applyItem` returns a new state and reads no clock, so any sequence of tasks replays identically.
 */
import { cacheHitRate, costOfEvent, detectRunawayLoops, fnv1a, stableStringify, totalPromptTokens } from "@ai-finops/interceptor";
import type { AgentLabel, RunawayLoopAlert, TelemetryEvent } from "@ai-finops/interceptor";
import { createRouter } from "@ai-finops/router";
import type { OffloadRecord, RuleId } from "@ai-finops/router";
import type { SimItem } from "./sprint";

export const FEED_LIMIT = 40;
const TITLE_LIMIT = 88;

export type FeedKind = "llm" | "offload" | "loop" | "blocked";

export interface FeedItem {
  readonly id: string;
  readonly atMs: number;
  readonly kind: FeedKind;
  readonly agent: AgentLabel;
  readonly title: string;
  /** llm: what the call cost. offload: what the script saved. loop: what the loop wasted. blocked: what the breaker saved. */
  readonly usd: number;
  readonly tokens: number;
  readonly model?: string;
  readonly cacheHitRate?: number;
  readonly ruleId?: RuleId;
  readonly repeats?: number;
}

export interface EngineState {
  /** Billed model calls. */
  readonly events: readonly TelemetryEvent[];
  /** One savings record per task a script answered. */
  readonly offloads: readonly OffloadRecord[];
  /** Every task the router saw, whichever way it went. */
  readonly interceptedCalls: number;
  readonly loopAlerts: readonly RunawayLoopAlert[];
  /** `session|agent|fingerprint` keys the circuit breaker is holding shut. */
  readonly halted: readonly string[];
  /** Calls the breaker stopped, and what they would have cost. */
  readonly prevented: { readonly calls: number; readonly usd: number };
  /** Newest first, capped at FEED_LIMIT. */
  readonly feed: readonly FeedItem[];
  /** Simulated time of the last applied task. */
  readonly clockMs: number;
}

export const EMPTY_ENGINE: EngineState = {
  events: [],
  offloads: [],
  interceptedCalls: 0,
  loopAlerts: [],
  halted: [],
  prevented: { calls: 0, usd: 0 },
  feed: [],
  clockMs: 0,
};

const router = createRouter();

const truncate = (text: string): string => (text.length > TITLE_LIMIT ? `${text.slice(0, TITLE_LIMIT - 1)}…` : text);
const pushFeed = (feed: readonly FeedItem[], entry: FeedItem): FeedItem[] => [entry, ...feed].slice(0, FEED_LIMIT);
const loopKey = (sessionId: string, agent: AgentLabel, fingerprint: string): string => `${sessionId}|${agent}|${fingerprint}`;

function toEvent(item: SimItem, fingerprint: string): TelemetryEvent {
  const { task, llm } = item;
  return {
    id: task.id,
    timestamp: new Date(item.atMs + llm.latencyMs).toISOString(),
    sessionId: item.sessionId,
    agent: task.agent,
    model: task.model,
    usage: llm.usage,
    latencyMs: llm.latencyMs,
    source: "simulator",
    featureId: llm.featureId,
    ...(llm.milestone === undefined ? {} : { milestone: llm.milestone }),
    fingerprint,
  };
}

export function applyItem(state: EngineState, item: SimItem): EngineState {
  const { task } = item;
  const base = { interceptedCalls: state.interceptedCalls + 1, clockMs: item.atMs };
  const decision = router.route(task);

  if (decision.route === "script") {
    const { record } = decision;
    return {
      ...state,
      ...base,
      offloads: [...state.offloads, record],
      feed: pushFeed(state.feed, {
        id: task.id,
        atMs: item.atMs,
        kind: "offload",
        agent: task.agent,
        title: truncate(task.prompt),
        usd: record.offloaded_savings_usd,
        // Fresh tokens only: cached context the call would have re-read is priced in `usd`, not counted here.
        tokens: record.avoided_input_tokens + record.avoided_output_tokens,
        ruleId: record.rule_id,
      }),
    };
  }

  const fingerprint = fnv1a(stableStringify({ prompt: task.prompt, operation: task.operation ?? null, inputs: task.inputs ?? null }));
  const event = toEvent(item, fingerprint);
  const cost = costOfEvent(event)?.totalUsd ?? 0;
  const tokens = totalPromptTokens(event.usage) + event.usage.outputTokens;

  if (state.halted.includes(loopKey(item.sessionId, task.agent, fingerprint))) {
    return {
      ...state,
      ...base,
      prevented: { calls: state.prevented.calls + 1, usd: state.prevented.usd + cost },
      feed: pushFeed(state.feed, { id: task.id, atMs: item.atMs, kind: "blocked", agent: task.agent, title: truncate(task.prompt), usd: cost, tokens }),
    };
  }

  const events = [...state.events, event];
  let feed = pushFeed(state.feed, {
    id: task.id,
    atMs: item.atMs,
    kind: "llm",
    agent: task.agent,
    title: truncate(task.prompt),
    usd: cost,
    tokens,
    model: task.model,
    cacheHitRate: cacheHitRate(event.usage),
  });

  let loopAlerts = state.loopAlerts;
  let halted = state.halted;
  for (const alert of detectRunawayLoops(events)) {
    const key = loopKey(alert.sessionId, alert.agent, alert.fingerprint);
    if (halted.includes(key)) continue;
    loopAlerts = [...loopAlerts, alert];
    halted = [...halted, key];
    feed = pushFeed(feed, {
      id: `loop:${task.id}`,
      atMs: item.atMs,
      kind: "loop",
      agent: alert.agent,
      title: "Runaway loop caught: the same request keeps repeating",
      usd: alert.wastedCostUsd,
      tokens: alert.wastedTokens,
      repeats: alert.repeats,
    });
  }

  return { ...state, ...base, events, loopAlerts, halted, feed };
}
