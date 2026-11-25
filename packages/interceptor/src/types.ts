/**
 * Core domain types. This file is the single source of truth for token usage
 * shape; everything else (pricing, cost, parsing, aggregation) builds on it.
 */

/**
 * Token counts for one model call, split the way Anthropic bills them.
 *
 * `inputTokens` is the *uncached remainder only* (the API's `input_tokens`).
 * Total prompt size is `inputTokens + cacheReadTokens + cacheWrite5mTokens + cacheWrite1hTokens`.
 * All fields are non-negative safe integers.
 */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  /** Tokens written to the 5-minute prompt cache (billed at 1.25x input). */
  readonly cacheWrite5mTokens: number;
  /** Tokens written to the 1-hour prompt cache (billed at 2x input). */
  readonly cacheWrite1hTokens: number;
}

/** The subagents whose spend we attribute individually. */
export const AGENT_NAMES = ["PM_Agent", "Architect_Agent", "Security_Agent", "Release_Agent"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

/** Bucket for calls that cannot be tied to one of the four subagents (e.g. the main orchestrator thread). */
export const UNATTRIBUTED = "Unattributed" as const;
export type AgentLabel = AgentName | typeof UNATTRIBUTED;

export type EventSource = "claude-code-log" | "api-payload" | "simulator";

/** Business milestones that denominate unit economics (cost per feature shipped). */
export type Milestone = "feature_shipped";

/** One billed model call, normalised from any ingestion source. */
export interface TelemetryEvent {
  /** Stable unique id, used to de-duplicate (`message.id|requestId` for Claude Code logs). */
  readonly id: string;
  /** ISO-8601 UTC, completion time of the call. */
  readonly timestamp: string;
  readonly sessionId: string;
  readonly agent: AgentLabel;
  /** Model id as reported by the API; resolved to pricing separately. */
  readonly model: string;
  readonly usage: TokenUsage;
  /** Wall-clock latency of the call in ms, or null when it cannot be derived. */
  readonly latencyMs: number | null;
  readonly source: EventSource;
  readonly featureId?: string;
  readonly milestone?: Milestone;
  /**
   * Hash of what the call asked for (its tool calls). Repeats of the same
   * fingerprint by the same agent are the signature of a runaway loop.
   */
  readonly fingerprint?: string;
}

export type ParseWarningCode =
  | "invalid_json"
  | "invalid_record"
  | "missing_usage"
  | "invalid_usage"
  | "invalid_timestamp"
  | "unknown_agent";

export interface ParseWarning {
  /** 1-based line (JSONL) or 1-based payload index. */
  readonly line: number;
  readonly code: ParseWarningCode;
  readonly message: string;
}

export interface ParseStats {
  /** Non-blank records examined. */
  readonly recordsRead: number;
  readonly eventsParsed: number;
  /** Repeated lines/payloads for an already-seen call (one log line per content block). */
  readonly duplicatesDropped: number;
  /** Valid records that carry no billed call (user turns, attachments, synthetic errors). */
  readonly ignored: number;
}

export interface ParseResult {
  /** Sorted by timestamp ascending. */
  readonly events: readonly TelemetryEvent[];
  readonly warnings: readonly ParseWarning[];
  readonly stats: ParseStats;
}
