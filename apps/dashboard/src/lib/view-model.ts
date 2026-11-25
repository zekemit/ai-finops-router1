/** Turns engine state into exactly the numbers and series the UI shows. No React, no formatting. */
import { computeBurnRate, costOfEvent, summarize } from "@ai-finops/interceptor";
import type { AgentLabel, Summary } from "@ai-finops/interceptor";
import { combineSavings, summarizeOffloads } from "@ai-finops/router";
import { RULE_IDS } from "@ai-finops/router";
import type { CombinedSavings, OffloadSummary, RuleId } from "@ai-finops/router";
import type { EngineState } from "./engine";

export const BURN_WINDOW_MS = 60_000;

export interface BurnKpi {
  readonly usdPerMinute: number;
  readonly tokensPerMinute: number;
  readonly activeAgents: readonly AgentLabel[];
  readonly byAgent: readonly { readonly agent: AgentLabel; readonly usdPerMinute: number }[];
  readonly windowMs: number;
  /** Simulated time at the right edge of the window. */
  readonly atMs: number;
  /** True while a sprint is streaming; false when showing the last recorded minute. */
  readonly live: boolean;
}

export interface Kpis {
  readonly totalSpendUsd: number;
  readonly featuresShipped: number;
  readonly costPerFeatureUsd: number | null;
  /** The same feature's cost with neither prompt caching nor script offloading. */
  readonly counterfactualPerFeatureUsd: number | null;
  readonly savings: CombinedSavings;
  readonly cacheHitRate: number;
  readonly burn: BurnKpi;
  readonly summary: Summary;
  readonly offloads: OffloadSummary;
  /**
   * Tokens each script saved the model from reading or writing: prompt, attached data and answer. Excludes cached
   * context the avoided call would merely have re-read (that is priced into the dollars, and would inflate this count).
   */
  readonly offloadTokensByRule: Readonly<Record<RuleId, number>>;
  /** Spend lost to loops before the breaker engaged. */
  readonly loopWastedUsd: number;
  /** Spend the breaker stopped. */
  readonly preventedUsd: number;
}

/**
 * @param nowMs  Simulated "now" while a sprint streams; `null` when idle (the burn rate then reflects the
 *               last recorded minute of activity instead of a dead zero).
 */
export function computeKpis(state: EngineState, nowMs: number | null, live: boolean): Kpis {
  const summary = summarize(state.events);
  const offloads = summarizeOffloads(state.offloads, { actualSpendUsd: summary.totalCostUsd, interceptedCalls: state.interceptedCalls });
  const savings = combineSavings(summary, offloads);

  const lastEventMs = state.events.reduce((latest, event) => Math.max(latest, Date.parse(event.timestamp)), 0);
  const atMs = nowMs ?? lastEventMs;
  const rate = computeBurnRate(state.events, atMs, { windowMs: BURN_WINDOW_MS });

  return {
    totalSpendUsd: summary.totalCostUsd,
    featuresShipped: summary.featuresShipped,
    costPerFeatureUsd: summary.costPerFeatureUsd,
    counterfactualPerFeatureUsd: summary.featuresShipped > 0 ? savings.counterfactualUsd / summary.featuresShipped : null,
    savings,
    cacheHitRate: summary.cacheHitRate,
    burn: {
      usdPerMinute: rate.costUsdPerMinute,
      tokensPerMinute: rate.tokensPerMinute,
      activeAgents: rate.activeAgents,
      byAgent: rate.byAgent.map((a) => ({ agent: a.agent, usdPerMinute: a.costUsdPerMinute })),
      windowMs: BURN_WINDOW_MS,
      atMs,
      live,
    },
    summary,
    offloads,
    offloadTokensByRule: Object.fromEntries(
      RULE_IDS.map((rule) => [
        rule,
        state.offloads.filter((o) => o.rule_id === rule).reduce((sum, o) => sum + o.avoided_input_tokens + o.avoided_output_tokens, 0),
      ]),
    ) as Record<RuleId, number>,
    loopWastedUsd: state.loopAlerts.reduce((sum, alert) => sum + alert.wastedCostUsd, 0),
    preventedUsd: state.prevented.usd,
  };
}

export interface SeriesPoint {
  readonly atMs: number;
  /** Cumulative dollars actually billed. */
  readonly actualUsd: number;
  /** Cumulative dollars the same work would have cost with no caching and no script offloading. */
  readonly withoutOptimizationUsd: number;
}

/** The two cumulative lines whose widening gap is the story. At most `maxPoints` points, first and last kept. */
export function spendSeries(state: EngineState, maxPoints = 160): SeriesPoint[] {
  const steps = [
    ...state.events.map((event) => {
      const cost = costOfEvent(event);
      return { atMs: Date.parse(event.timestamp), actual: cost?.totalUsd ?? 0, without: cost?.baselineUsd ?? 0 };
    }),
    ...state.offloads.map((record) => ({ atMs: Date.parse(record.timestamp), actual: 0, without: record.offloaded_savings_usd })),
  ].sort((a, b) => a.atMs - b.atMs);

  let actualUsd = 0;
  let withoutOptimizationUsd = 0;
  const series = steps.map((step) => {
    actualUsd += step.actual;
    withoutOptimizationUsd += step.without;
    return { atMs: step.atMs, actualUsd, withoutOptimizationUsd };
  });

  if (series.length <= maxPoints || maxPoints < 2) return series;
  return Array.from({ length: maxPoints }, (_, j) => series[Math.round((j * (series.length - 1)) / (maxPoints - 1))]).filter(
    (point): point is SeriesPoint => point !== undefined,
  );
}

export interface SprintRow {
  readonly sessionId: string;
  readonly label: string;
  readonly features: number;
  readonly spendUsd: number;
  readonly withoutOptimizationUsd: number;
  readonly savedUsd: number;
  /** `savedUsd / withoutOptimizationUsd`. */
  readonly savedPct: number;
}

const SESSION_INDEX = /^sprint-(\d+)$/;

/** Per-sprint spend and savings: the table view of the chart. Sums to the dashboard totals by construction. */
export function sprintRows(state: EngineState): SprintRow[] {
  const sprints = new Map<string, { spend: number; without: number; shipped: Set<string> }>();
  const bucket = (sessionId: string) => {
    let entry = sprints.get(sessionId);
    if (entry === undefined) {
      entry = { spend: 0, without: 0, shipped: new Set() };
      sprints.set(sessionId, entry);
    }
    return entry;
  };

  for (const event of state.events) {
    const cost = costOfEvent(event);
    const entry = bucket(event.sessionId);
    entry.spend += cost?.totalUsd ?? 0;
    entry.without += cost?.baselineUsd ?? 0;
    if (event.milestone === "feature_shipped" && event.featureId !== undefined) entry.shipped.add(event.featureId);
  }
  for (const record of state.offloads) {
    const index = /^s(\d+)-/.exec(record.task_id)?.[1];
    if (index !== undefined) bucket(`sprint-${index}`).without += record.offloaded_savings_usd;
  }

  const order = (sessionId: string): number => Number(SESSION_INDEX.exec(sessionId)?.[1] ?? Number.POSITIVE_INFINITY);
  return [...sprints]
    .sort(([a], [b]) => order(a) - order(b))
    .map(([sessionId, entry]) => {
      const index = SESSION_INDEX.exec(sessionId)?.[1];
      const savedUsd = entry.without - entry.spend;
      return {
        sessionId,
        label: index === undefined ? sessionId : `Sprint ${Number(index) + 1}`,
        features: entry.shipped.size,
        spendUsd: entry.spend,
        withoutOptimizationUsd: entry.without,
        savedUsd,
        savedPct: entry.without === 0 ? 0 : savedUsd / entry.without,
      };
    });
}
