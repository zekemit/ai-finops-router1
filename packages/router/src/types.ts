import type { AgentLabel } from "@ai-finops/interceptor";
import type { TestSummary } from "./scripts/test-summary";

/** An in-memory file: the data a subagent would otherwise paste into an LLM prompt. */
export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export const RULE_IDS = ["json-format", "test-summary", "lint-check", "grep-search"] as const;
export type RuleId = (typeof RULE_IDS)[number];

/** Data attached to a task. This is what the LLM call would have been billed for reading. */
export interface TaskInputs {
  readonly text?: string;
  readonly files?: readonly SourceFile[];
  readonly schema?: unknown;
  readonly pattern?: string;
  /** Treat `pattern` as a regular expression (default: literal text). */
  readonly regex?: boolean;
  readonly caseInsensitive?: boolean;
  readonly mode?: "pretty" | "minify";
  readonly indent?: number;
  readonly sortKeys?: boolean;
  readonly maxLineLength?: number;
}

/** A unit of work a subagent is about to send to a frontier model. */
export interface SubagentTask {
  readonly id: string;
  /** ISO-8601. Carried into the savings record; the router never reads a clock. */
  readonly timestamp: string;
  readonly agent: AgentLabel;
  /** The model the agent would have called; its rates price the avoided call. */
  readonly model: string;
  readonly prompt: string;
  /** Optional explicit, machine-readable intent (`json.format`, `lint`, `grep`, `test.summary`, ...). */
  readonly operation?: string;
  readonly inputs?: TaskInputs;
  /** Cached context the avoided call would have re-read. Defaults to 0, which keeps savings a conservative floor. */
  readonly contextTokens?: number;
}

export type ScriptOutcome =
  | { readonly ruleId: "json-format"; readonly output: string; readonly data: { readonly valid: boolean; readonly schemaIssues: number } }
  | { readonly ruleId: "lint-check"; readonly output: string; readonly data: { readonly issues: number; readonly errors: number; readonly warnings: number } }
  | { readonly ruleId: "grep-search"; readonly output: string; readonly data: { readonly totalMatches: number; readonly filesWithMatches: number; readonly truncated: boolean } }
  | { readonly ruleId: "test-summary"; readonly output: string; readonly data: TestSummary };

export type RuleVerdict =
  | { readonly matched: true; readonly run: () => ScriptOutcome }
  | { readonly matched: false; readonly reason: string };

/** A deterministic rule: decides, without any I/O, whether a task is a purely mechanical job, and how to do it locally. */
export interface OffloadRule {
  readonly id: RuleId;
  readonly description: string;
  /** Explicit `task.operation` values this rule handles. */
  readonly operations?: readonly string[];
  evaluate(task: SubagentTask): RuleVerdict;
}

/** One log line per intercepted call. snake_case: this is the wire format of the savings log. */
export interface OffloadRecord {
  readonly task_id: string;
  readonly timestamp: string;
  readonly agent: AgentLabel;
  readonly model: string;
  readonly rule_id: RuleId;
  readonly avoided_input_tokens: number;
  readonly avoided_cache_read_tokens: number;
  readonly avoided_output_tokens: number;
  /** Every token the avoided call would have processed: input + re-read context + output. */
  readonly avoided_tokens: number;
  /** Dollars the avoided call would have cost at `model`'s rates; 0 when `priced` is false. */
  readonly offloaded_savings_usd: number;
  /** False when `model` has no pricing entry, so the dollar figure is a floor, not an estimate. */
  readonly priced: boolean;
  /** Counts are estimates: the LLM call never happened, so there is no API usage to read. */
  readonly token_counts: "estimated";
}

export interface ConsideredRule {
  readonly ruleId: RuleId;
  readonly reason: string;
}

export interface ScriptDecision {
  readonly route: "script";
  readonly taskId: string;
  readonly ruleId: RuleId;
  readonly outcome: ScriptOutcome;
  readonly record: OffloadRecord;
}

export interface LlmDecision {
  readonly route: "llm";
  readonly taskId: string;
  readonly reason: string;
  /** Why each rule declined, in evaluation order. */
  readonly considered: readonly ConsideredRule[];
}

export type RouteDecision = ScriptDecision | LlmDecision;
