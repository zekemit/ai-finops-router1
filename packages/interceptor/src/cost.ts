import type { ModelPricing } from "./pricing";
import type { TokenUsage } from "./types";
import { totalPromptTokens } from "./usage";

const TOKENS_PER_MTOK = 1_000_000;

export interface CostBreakdown {
  readonly inputUsd: number;
  readonly outputUsd: number;
  readonly cacheReadUsd: number;
  readonly cacheWriteUsd: number;
  /** What was actually billed. */
  readonly totalUsd: number;
  /** What the same call would have cost with no caching: every prompt token at the plain input rate. */
  readonly baselineUsd: number;
  /**
   * `baselineUsd - totalUsd`. Negative when cache writes were never read back,
   * because the write premium (1.25x / 2x) is a real cost.
   */
  readonly cacheSavingsUsd: number;
}

function usd(tokens: number, perMTok: number): number {
  return (tokens * perMTok) / TOKENS_PER_MTOK;
}

/** Pure cost math: integer token counts x per-MTok USD prices. No rounding; round at presentation. */
export function calculateCost(usage: TokenUsage, pricing: ModelPricing): CostBreakdown {
  const inputUsd = usd(usage.inputTokens, pricing.inputPerMTok);
  const outputUsd = usd(usage.outputTokens, pricing.outputPerMTok);
  const cacheReadUsd = usd(usage.cacheReadTokens, pricing.cacheReadPerMTok);
  const cacheWriteUsd =
    usd(usage.cacheWrite5mTokens, pricing.cacheWrite5mPerMTok) +
    usd(usage.cacheWrite1hTokens, pricing.cacheWrite1hPerMTok);
  const totalUsd = inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd;
  const baselineUsd = usd(totalPromptTokens(usage), pricing.inputPerMTok) + outputUsd;
  return {
    inputUsd,
    outputUsd,
    cacheReadUsd,
    cacheWriteUsd,
    totalUsd,
    baselineUsd,
    cacheSavingsUsd: baselineUsd - totalUsd,
  };
}

/** Share of prompt tokens served from the prompt cache, in [0, 1]. 0 when there is no prompt. */
export function cacheHitRate(usage: TokenUsage): number {
  const prompt = totalPromptTokens(usage);
  return prompt === 0 ? 0 : usage.cacheReadTokens / prompt;
}
