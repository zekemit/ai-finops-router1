import { DEFAULT_PRICING, calculateCost, makeUsage, resolvePricing } from "@ai-finops/interceptor";
import type { PricingTable } from "@ai-finops/interceptor";
import type { TokenEstimator } from "./tokens";
import type { OffloadRecord, RuleId, ScriptOutcome, SubagentTask } from "./types";

export interface SavingsContext {
  readonly pricing: PricingTable;
  readonly estimate: TokenEstimator;
}

/** Everything attached to the task that the avoided LLM call would have read. */
function inputPayload(task: SubagentTask): string {
  const inputs = task.inputs;
  if (inputs === undefined) return "";
  const parts = [
    inputs.text,
    ...(inputs.files ?? []).map((file) => `${file.path}\n${file.content}`),
    inputs.schema === undefined ? undefined : JSON.stringify(inputs.schema),
    inputs.pattern,
  ];
  return parts.filter((part): part is string => part !== undefined && part !== "").join("\n");
}

function count(estimate: TokenEstimator, text: string): number {
  const n = estimate(text);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0;
}

/**
 * Price the LLM call that did not happen, using the interceptor's own cost engine:
 *   payload (prompt + attached data) as input  +  re-read context at the cache-read rate  +  the answer as output.
 * Conservative on purpose: payload is billed at the plain input rate (not the 1.25x cache-write rate), the
 * answer is the script's output with no model preamble, and context defaults to 0 unless the task states it.
 */
export function buildOffloadRecord(task: SubagentTask, ruleId: RuleId, outcome: ScriptOutcome, context: SavingsContext = { pricing: DEFAULT_PRICING, estimate: (t) => Math.ceil(t.length / 4) }): OffloadRecord {
  const inputTokens = count(context.estimate, task.prompt) + count(context.estimate, inputPayload(task));
  const outputTokens = count(context.estimate, outcome.output);
  const ctx = task.contextTokens;
  const cacheReadTokens = ctx !== undefined && Number.isSafeInteger(ctx) && ctx >= 0 ? ctx : 0;

  const pricing = resolvePricing(task.model, context.pricing);
  const usage = makeUsage({ inputTokens, outputTokens, cacheReadTokens });

  return {
    task_id: task.id,
    timestamp: task.timestamp,
    agent: task.agent,
    model: task.model,
    rule_id: ruleId,
    avoided_input_tokens: inputTokens,
    avoided_cache_read_tokens: cacheReadTokens,
    avoided_output_tokens: outputTokens,
    avoided_tokens: inputTokens + cacheReadTokens + outputTokens,
    offloaded_savings_usd: pricing === undefined ? 0 : calculateCost(usage, pricing).totalUsd,
    priced: pricing !== undefined,
    token_counts: "estimated",
  };
}
