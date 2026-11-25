/**
 * @ai-finops/interceptor — public API.
 *
 * Browser-safe: nothing exported here touches Node. The CLI (`cli.ts`, `node-io.ts`, `bin.ts`)
 * is deliberately not re-exported.
 */

export { AGENT_NAMES, UNATTRIBUTED } from "./types";
export type {
  AgentLabel,
  AgentName,
  EventSource,
  Milestone,
  ParseResult,
  ParseStats,
  ParseWarning,
  ParseWarningCode,
  TelemetryEvent,
  TokenUsage,
} from "./types";

export { ZERO_USAGE, addUsage, makeUsage, totalPromptTokens } from "./usage";

export { DEFAULT_PRICING, resolvePricing } from "./pricing";
export type { ModelPricing, PricingTable } from "./pricing";

export { cacheHitRate, calculateCost } from "./cost";
export type { CostBreakdown } from "./cost";

export { normalizeAgentName } from "./attribution";

export { parseClaudeCodeJsonl } from "./jsonl-parser";
export type { ParseJsonlOptions } from "./jsonl-parser";
export { parseApiPayloadText, parseApiPayloads } from "./payload-parser";
export { sortEvents } from "./parse-common";

export { costOfEvent, summarize } from "./aggregate";
export type { AgentSummary, ModelSummary, Summary } from "./aggregate";

export { computeBurnRate, detectRunawayLoops } from "./analytics";
export type { BurnRate, BurnRateOptions, LoopDetectorOptions, RunawayLoopAlert } from "./analytics";

export { fnv1a, stableStringify } from "./hash";

export { formatInt, formatMs, formatPct, formatUsd } from "./format";
export { formatSummaryReport } from "./report";
