import { costOfEvent } from "./aggregate";
import { DEFAULT_PRICING } from "./pricing";
import type { PricingTable } from "./pricing";
import { AGENT_NAMES, UNATTRIBUTED } from "./types";
import type { AgentLabel, TelemetryEvent } from "./types";
import { totalPromptTokens } from "./usage";

const MS_PER_MINUTE = 60_000;
const CANONICAL_ORDER: readonly AgentLabel[] = [...AGENT_NAMES, UNATTRIBUTED];

function tokensOf(event: TelemetryEvent): number {
  return totalPromptTokens(event.usage) + event.usage.outputTokens;
}

// ---------------------------------------------------------------------------------------------
// Burn rate
// ---------------------------------------------------------------------------------------------

export interface BurnRate {
  readonly windowMs: number;
  readonly costUsdPerMinute: number;
  readonly tokensPerMinute: number;
  /** Agents with at least one call inside the window, in canonical order. */
  readonly activeAgents: readonly AgentLabel[];
  readonly byAgent: readonly { readonly agent: AgentLabel; readonly costUsdPerMinute: number }[];
}

export interface BurnRateOptions {
  /** Trailing window length. Default 60,000 ms. */
  readonly windowMs?: number;
  readonly pricing?: PricingTable;
}

/**
 * Spend velocity over the trailing window `(nowMs - windowMs, nowMs]`, normalised to per minute.
 * `nowMs` is passed in (never read from a clock) so the function stays deterministic and testable.
 * Calls on unpriced models add tokens but no dollars.
 */
export function computeBurnRate(events: readonly TelemetryEvent[], nowMs: number, options: BurnRateOptions = {}): BurnRate {
  const windowMs = options.windowMs ?? MS_PER_MINUTE;
  const pricing = options.pricing ?? DEFAULT_PRICING;
  const minutes = windowMs / MS_PER_MINUTE;

  let costUsd = 0;
  let tokens = 0;
  const perAgent = new Map<AgentLabel, number>();

  for (const event of events) {
    const ms = Date.parse(event.timestamp);
    if (!(ms > nowMs - windowMs && ms <= nowMs)) continue;
    const eventCost = costOfEvent(event, pricing)?.totalUsd ?? 0;
    costUsd += eventCost;
    tokens += tokensOf(event);
    perAgent.set(event.agent, (perAgent.get(event.agent) ?? 0) + eventCost);
  }

  const active = CANONICAL_ORDER.filter((agent) => perAgent.has(agent));
  return {
    windowMs,
    costUsdPerMinute: costUsd / minutes,
    tokensPerMinute: tokens / minutes,
    activeAgents: active,
    byAgent: active.map((agent) => ({ agent, costUsdPerMinute: (perAgent.get(agent) ?? 0) / minutes })),
  };
}

// ---------------------------------------------------------------------------------------------
// Runaway-loop detection
// ---------------------------------------------------------------------------------------------

export interface RunawayLoopAlert {
  readonly agent: AgentLabel;
  readonly sessionId: string;
  readonly fingerprint: string;
  /** Number of identical consecutive calls, the first included. */
  readonly repeats: number;
  readonly firstTimestamp: string;
  readonly lastTimestamp: string;
  /** Spend on every repeat after the first: money burned making no progress. */
  readonly wastedCostUsd: number;
  readonly wastedTokens: number;
}

export interface LoopDetectorOptions {
  /** Identical consecutive calls needed to raise an alert; must be >= 2. Default 4. */
  readonly minRepeats?: number;
  /** Max gap between consecutive repeats for them to count as one run. Default 120,000 ms. */
  readonly windowMs?: number;
  readonly pricing?: PricingTable;
}

/**
 * Finds agents stuck repeating the exact same call. A run is consecutive fingerprinted calls by the
 * same agent in the same session with an identical fingerprint and gaps no longer than `windowMs`.
 * A different call in between counts as progress and ends the run, so edit/test cycles are not
 * flagged — only true no-progress repetition. Calls with no fingerprint are ignored.
 */
export function detectRunawayLoops(events: readonly TelemetryEvent[], options: LoopDetectorOptions = {}): RunawayLoopAlert[] {
  const minRepeats = options.minRepeats ?? 4;
  const windowMs = options.windowMs ?? 120_000;
  const pricing = options.pricing ?? DEFAULT_PRICING;

  const streams = new Map<string, { event: TelemetryEvent; ms: number }[]>();
  for (const event of events) {
    if (event.fingerprint === undefined) continue;
    const key = `${event.sessionId}\u0000${event.agent}`;
    const stream = streams.get(key) ?? [];
    stream.push({ event, ms: Date.parse(event.timestamp) });
    streams.set(key, stream);
  }

  const alerts: { alert: RunawayLoopAlert; ms: number }[] = [];

  const flush = (run: { event: TelemetryEvent; ms: number }[]): void => {
    const head = run[0];
    const tail = run[run.length - 1];
    if (head === undefined || tail === undefined || run.length < minRepeats || head.event.fingerprint === undefined) return;
    const repeats = run.slice(1);
    alerts.push({
      ms: head.ms,
      alert: {
        agent: head.event.agent,
        sessionId: head.event.sessionId,
        fingerprint: head.event.fingerprint,
        repeats: run.length,
        firstTimestamp: head.event.timestamp,
        lastTimestamp: tail.event.timestamp,
        wastedCostUsd: repeats.reduce((sum, r) => sum + (costOfEvent(r.event, pricing)?.totalUsd ?? 0), 0),
        wastedTokens: repeats.reduce((sum, r) => sum + tokensOf(r.event), 0),
      },
    });
  };

  for (const stream of streams.values()) {
    stream.sort((a, b) => a.ms - b.ms);
    let run: { event: TelemetryEvent; ms: number }[] = [];
    for (const item of stream) {
      const last = run[run.length - 1];
      if (last !== undefined && last.event.fingerprint === item.event.fingerprint && item.ms - last.ms <= windowMs) {
        run.push(item);
      } else {
        flush(run);
        run = [item];
      }
    }
    flush(run);
  }

  return alerts.sort((a, b) => a.ms - b.ms).map(({ alert }) => alert);
}
