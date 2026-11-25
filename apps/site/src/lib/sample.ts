import { calculateCost, makeUsage, resolvePricing } from "@ai-finops/interceptor";
import type { TokenUsage } from "@ai-finops/interceptor";

function priceSample(): { usage: TokenUsage; usd: number } {
  const usage = makeUsage({ inputTokens: 2, outputTokens: 800, cacheReadTokens: 61_517, cacheWrite1hTokens: 55_115 });
  const pricing = resolvePricing("claude-sonnet-5-5");
  if (pricing === undefined) throw new Error("claude-sonnet-5-5 is missing from the interceptor's price table");
  return { usage, usd: calculateCost(usage, pricing).totalUsd };
}

/** One call with the token shape of a real Claude Code turn, priced by the interceptor's own engine. */
export const SAMPLE_CALL = priceSample();

export interface Overcount {
  readonly blocks: number;
  /** What you get by adding up every log line of the call. */
  readonly summedUsd: number;
  /** What the call actually cost. */
  readonly correctUsd: number;
  readonly factor: number;
}

/** A call logged as `blocks` lines repeats its usage on each one; summing the lines bills it `blocks` times. */
export function overcount(blocks: number): Overcount {
  if (!Number.isInteger(blocks) || blocks < 1) throw new RangeError(`blocks must be a whole number of at least 1, received ${String(blocks)}`);
  return { blocks, summedUsd: SAMPLE_CALL.usd * blocks, correctUsd: SAMPLE_CALL.usd, factor: blocks };
}
