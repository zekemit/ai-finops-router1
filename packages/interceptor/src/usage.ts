import type { TokenUsage } from "./types";

export const ZERO_USAGE: TokenUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
});

const USAGE_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWrite5mTokens",
  "cacheWrite1hTokens",
] as const satisfies readonly (keyof TokenUsage)[];

/**
 * Build a validated `TokenUsage`. Missing fields default to 0.
 * Throws `RangeError` for negative, fractional, NaN or infinite counts: money
 * is derived from these numbers, so garbage must fail loudly instead of
 * producing a plausible-looking cost.
 */
export function makeUsage(partial: Partial<TokenUsage> = {}): TokenUsage {
  const out: Record<keyof TokenUsage, number> = { ...ZERO_USAGE };
  for (const field of USAGE_FIELDS) {
    const value = partial[field];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${field} must be a non-negative integer, received ${String(value)}`);
    }
    out[field] = value;
  }
  return out;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWrite5mTokens: a.cacheWrite5mTokens + b.cacheWrite5mTokens,
    cacheWrite1hTokens: a.cacheWrite1hTokens + b.cacheWrite1hTokens,
  };
}

/** Everything sent to the model: uncached input + cache reads + cache writes. Excludes output. */
export function totalPromptTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheWrite5mTokens + usage.cacheWrite1hTokens;
}
