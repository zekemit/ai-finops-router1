/**
 * @ai-finops/router — deterministic offloading engine.
 *
 * Pure and browser-safe: no Node imports, no clock, no randomness. Same task in, same decision out.
 */

export { createRouter } from "./router";
export type { HandledResult, Router, RouterOptions } from "./router";

export { DEFAULT_RULES, grepSearchRule, jsonFormatRule, lintCheckRule, testSummaryRule } from "./rules";

export { RULE_IDS } from "./types";
export type {
  ConsideredRule,
  LlmDecision,
  OffloadRecord,
  OffloadRule,
  RouteDecision,
  RuleId,
  RuleVerdict,
  ScriptDecision,
  ScriptOutcome,
  SourceFile,
  SubagentTask,
  TaskInputs,
} from "./types";

export { estimateTokens } from "./tokens";
export type { TokenEstimator } from "./tokens";

export { buildOffloadRecord } from "./savings";
export { summarizeOffloads } from "./summary";
export type { OffloadSummary, RuleSavings, SummarizeOptions } from "./summary";
export { combineSavings } from "./combine";
export type { CombinedSavings } from "./combine";

export { formatJson } from "./scripts/json";
export type { JsonFormatOptions, JsonFormatResult, JsonParseError } from "./scripts/json";
export { findUnsupportedKeywords, validateJsonSchema } from "./scripts/json-schema";
export type { SchemaIssue } from "./scripts/json-schema";
export { lintFiles } from "./scripts/lint";
export type { LintIssue, LintOptions, LintRuleId } from "./scripts/lint";
export { grepFiles } from "./scripts/grep";
export type { GrepMatch, GrepOptions, GrepResult } from "./scripts/grep";
export { compilePattern, isSafePattern } from "./scripts/regex";
export { detectFramework, summarizeTestOutput } from "./scripts/test-summary";
export type { TestFailure, TestFramework, TestSummary } from "./scripts/test-summary";
