import type { Summary } from "@ai-finops/interceptor";
import type { OffloadSummary } from "./summary";

export interface CombinedSavings {
  /** What was actually billed. */
  readonly actualUsd: number;
  readonly cacheSavingsUsd: number;
  readonly offloadSavingsUsd: number;
  readonly totalSavingsUsd: number;
  /** The bill with neither prompt caching nor script offloading: no-cache cost of the real calls + the offloaded calls. */
  readonly counterfactualUsd: number;
  /** `totalSavingsUsd / counterfactualUsd`, 0 when there is no traffic. */
  readonly totalSavingsPct: number;
}

/**
 * The headline "Cache & Script Offloading Savings": prompt-cache savings (from telemetry) plus the
 * avoided LLM calls (from the router), measured against the no-cache, no-offload counterfactual.
 */
export function combineSavings(telemetry: Summary, offloads: OffloadSummary): CombinedSavings {
  const counterfactualUsd = telemetry.baselineUsd + offloads.savedUsd;
  const totalSavingsUsd = telemetry.cacheSavingsUsd + offloads.savedUsd;
  return {
    actualUsd: telemetry.totalCostUsd,
    cacheSavingsUsd: telemetry.cacheSavingsUsd,
    offloadSavingsUsd: offloads.savedUsd,
    totalSavingsUsd,
    counterfactualUsd,
    totalSavingsPct: counterfactualUsd > 0 ? totalSavingsUsd / counterfactualUsd : 0,
  };
}
