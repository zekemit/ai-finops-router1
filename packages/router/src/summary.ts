import { RULE_IDS } from "./types";
import type { OffloadRecord, RuleId } from "./types";

export interface RuleSavings {
  readonly ruleId: RuleId;
  readonly calls: number;
  readonly avoidedTokens: number;
  readonly savedUsd: number;
}

export interface OffloadSummary {
  readonly offloadedCalls: number;
  readonly avoidedTokens: number;
  readonly savedUsd: number;
  readonly avgSavedPerCallUsd: number;
  /** Offloaded calls whose model had no pricing: `savedUsd` omits them, so treat it as a floor when this is > 0. */
  readonly unpricedCalls: number;
  /** All four rules, in evaluation order, zero-filled. */
  readonly byRule: readonly RuleSavings[];
  /** `saved / (actual + saved)`: the share of what these calls would have cost that was avoided. Null without `actualSpendUsd`. */
  readonly savingsPct: number | null;
  /** Share of intercepted calls that never reached the LLM. Null without a positive `interceptedCalls`. */
  readonly offloadRate: number | null;
}

export interface SummarizeOptions {
  /** What was actually spent on the calls that did reach the LLM. */
  readonly actualSpendUsd?: number;
  /** Every task the router saw, offloaded or not. */
  readonly interceptedCalls?: number;
}

export function summarizeOffloads(records: readonly OffloadRecord[], options: SummarizeOptions = {}): OffloadSummary {
  const savedUsd = records.reduce((sum, r) => sum + r.offloaded_savings_usd, 0);
  const actual = options.actualSpendUsd;
  const intercepted = options.interceptedCalls;
  return {
    offloadedCalls: records.length,
    avoidedTokens: records.reduce((sum, r) => sum + r.avoided_tokens, 0),
    savedUsd,
    avgSavedPerCallUsd: records.length === 0 ? 0 : savedUsd / records.length,
    unpricedCalls: records.filter((r) => !r.priced).length,
    byRule: RULE_IDS.map((ruleId) => {
      const mine = records.filter((r) => r.rule_id === ruleId);
      return {
        ruleId,
        calls: mine.length,
        avoidedTokens: mine.reduce((sum, r) => sum + r.avoided_tokens, 0),
        savedUsd: mine.reduce((sum, r) => sum + r.offloaded_savings_usd, 0),
      };
    }),
    savingsPct: actual === undefined ? null : actual + savedUsd === 0 ? 0 : savedUsd / (actual + savedUsd),
    offloadRate: intercepted === undefined || intercepted <= 0 ? null : records.length / intercepted,
  };
}
