import { cacheHitRate, calculateCost } from "./cost";
import type { CostBreakdown } from "./cost";
import { DEFAULT_PRICING, resolvePricing } from "./pricing";
import type { PricingTable } from "./pricing";
import { AGENT_NAMES, UNATTRIBUTED } from "./types";
import type { AgentLabel, TelemetryEvent, TokenUsage } from "./types";
import { ZERO_USAGE, addUsage } from "./usage";

export interface AgentSummary {
  readonly agent: AgentLabel;
  readonly calls: number;
  readonly usage: TokenUsage;
  /** Billed spend on calls whose model has pricing. */
  readonly costUsd: number;
  readonly baselineUsd: number;
  readonly cacheSavingsUsd: number;
  readonly cacheHitRate: number;
  readonly avgLatencyMs: number | null;
  readonly p95LatencyMs: number | null;
  /** Calls excluded from the dollar figures because their model has no pricing. */
  readonly unpricedCalls: number;
}

export interface ModelSummary {
  readonly model: string;
  readonly calls: number;
  readonly usage: TokenUsage;
  readonly costUsd: number;
}

export interface Summary {
  readonly calls: number;
  readonly usage: TokenUsage;
  readonly totalCostUsd: number;
  /** Cost of the same traffic with no prompt caching. */
  readonly baselineUsd: number;
  readonly cacheSavingsUsd: number;
  /** `cacheSavingsUsd / baselineUsd`, 0 when there is no baseline. */
  readonly cacheSavingsPct: number;
  readonly cacheHitRate: number;
  readonly avgLatencyMs: number | null;
  readonly p95LatencyMs: number | null;
  readonly featuresShipped: number;
  /** `totalCostUsd / featuresShipped`, null until something ships. */
  readonly costPerFeatureUsd: number | null;
  /** The four subagents (always present, in canonical order) then `Unattributed` if it has calls. */
  readonly byAgent: readonly AgentSummary[];
  readonly byModel: readonly ModelSummary[];
  /** Models with no pricing entry: tokens are counted, dollars are not. */
  readonly unpriced: readonly { readonly model: string; readonly calls: number }[];
  /** Models priced with an assumed (undocumented) cache-read rate. */
  readonly assumedPricingModels: readonly string[];
}

/** Cost of one event, or `undefined` when its model has no pricing (never guessed). */
export function costOfEvent(event: TelemetryEvent, pricing: PricingTable = DEFAULT_PRICING): CostBreakdown | undefined {
  const modelPricing = resolvePricing(event.model, pricing);
  return modelPricing === undefined ? undefined : calculateCost(event.usage, modelPricing);
}

/** Nearest-rank percentile (integer `pct`) of ascending-sorted values; null when empty. */
function nearestRank(sortedAsc: readonly number[], pct: number): number | null {
  if (sortedAsc.length === 0) return null;
  const rank = Math.ceil((pct * sortedAsc.length) / 100);
  return sortedAsc[Math.min(sortedAsc.length, Math.max(1, rank)) - 1] ?? null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

interface Accumulator {
  calls: number;
  usage: TokenUsage;
  costUsd: number;
  baselineUsd: number;
  unpricedCalls: number;
  latencies: number[];
}

function newAccumulator(): Accumulator {
  return { calls: 0, usage: ZERO_USAGE, costUsd: 0, baselineUsd: 0, unpricedCalls: 0, latencies: [] };
}

function accumulate(acc: Accumulator, event: TelemetryEvent, cost: CostBreakdown | undefined): void {
  acc.calls += 1;
  acc.usage = addUsage(acc.usage, event.usage);
  if (cost === undefined) acc.unpricedCalls += 1;
  else {
    acc.costUsd += cost.totalUsd;
    acc.baselineUsd += cost.baselineUsd;
  }
  if (event.latencyMs !== null) acc.latencies.push(event.latencyMs);
}

function toAgentSummary(agent: AgentLabel, acc: Accumulator): AgentSummary {
  const sorted = [...acc.latencies].sort((a, b) => a - b);
  return {
    agent,
    calls: acc.calls,
    usage: acc.usage,
    costUsd: acc.costUsd,
    baselineUsd: acc.baselineUsd,
    cacheSavingsUsd: acc.baselineUsd - acc.costUsd,
    cacheHitRate: cacheHitRate(acc.usage),
    avgLatencyMs: mean(acc.latencies),
    p95LatencyMs: nearestRank(sorted, 95),
    unpricedCalls: acc.unpricedCalls,
  };
}

/** Roll telemetry up into per-agent, per-model and fleet-level unit economics. Pure; no I/O, no clock. */
export function summarize(events: readonly TelemetryEvent[], pricing: PricingTable = DEFAULT_PRICING): Summary {
  const total = newAccumulator();
  const agents = new Map<AgentLabel, Accumulator>();
  const models = new Map<string, Accumulator>();
  const unpriced = new Map<string, number>();
  const assumed = new Set<string>();
  const shipped = new Set<string>();

  for (const name of AGENT_NAMES) agents.set(name, newAccumulator());

  for (const event of events) {
    const modelPricing = resolvePricing(event.model, pricing);
    const cost = modelPricing === undefined ? undefined : calculateCost(event.usage, modelPricing);
    if (modelPricing === undefined) unpriced.set(event.model, (unpriced.get(event.model) ?? 0) + 1);
    else if (modelPricing.source === "assumed") assumed.add(modelPricing.model);

    accumulate(total, event, cost);

    let agentAcc = agents.get(event.agent);
    if (agentAcc === undefined) {
      agentAcc = newAccumulator();
      agents.set(event.agent, agentAcc);
    }
    accumulate(agentAcc, event, cost);

    const modelKey = modelPricing?.model ?? event.model;
    let modelAcc = models.get(modelKey);
    if (modelAcc === undefined) {
      modelAcc = newAccumulator();
      models.set(modelKey, modelAcc);
    }
    accumulate(modelAcc, event, cost);

    if (event.milestone === "feature_shipped" && event.featureId !== undefined) shipped.add(event.featureId);
  }

  const ordered: AgentLabel[] = [...AGENT_NAMES];
  const unattributed = agents.get(UNATTRIBUTED);
  if (unattributed !== undefined && unattributed.calls > 0) ordered.push(UNATTRIBUTED);

  const sortedLatencies = [...total.latencies].sort((a, b) => a - b);
  const savings = total.baselineUsd - total.costUsd;

  return {
    calls: total.calls,
    usage: total.usage,
    totalCostUsd: total.costUsd,
    baselineUsd: total.baselineUsd,
    cacheSavingsUsd: savings,
    cacheSavingsPct: total.baselineUsd === 0 ? 0 : savings / total.baselineUsd,
    cacheHitRate: cacheHitRate(total.usage),
    avgLatencyMs: mean(total.latencies),
    p95LatencyMs: nearestRank(sortedLatencies, 95),
    featuresShipped: shipped.size,
    costPerFeatureUsd: shipped.size === 0 ? null : total.costUsd / shipped.size,
    byAgent: ordered.map((agent) => toAgentSummary(agent, agents.get(agent) ?? newAccumulator())),
    byModel: [...models].map(([model, acc]) => ({ model, calls: acc.calls, usage: acc.usage, costUsd: acc.costUsd })),
    unpriced: [...unpriced].map(([model, calls]) => ({ model, calls })),
    assumedPricingModels: [...assumed].sort(),
  };
}
