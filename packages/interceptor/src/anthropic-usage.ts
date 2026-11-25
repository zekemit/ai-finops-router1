import { isRecord } from "./guards";
import type { TokenUsage } from "./types";
import { makeUsage } from "./usage";

export type UsageParse =
  | { readonly ok: true; readonly usage: TokenUsage }
  | { readonly ok: false; readonly code: "missing_usage" | "invalid_usage"; readonly message: string };

/** Absent counter -> 0; a non-number -> NaN so `makeUsage` rejects it. */
function counter(value: unknown): number {
  if (value === undefined || value === null) return 0;
  return typeof value === "number" ? value : Number.NaN;
}

/**
 * Convert the Anthropic API `usage` object (as found in Messages responses and Claude Code logs)
 * into `TokenUsage`.
 *
 * Cache writes: `cache_creation.ephemeral_5m/1h_input_tokens` give the TTL tiers. Any
 * `cache_creation_input_tokens` the breakdown does not explain (or all of them, when there is no
 * breakdown) is assigned to the 5-minute tier so no billed tokens are lost.
 */
export function parseApiUsage(raw: unknown): UsageParse {
  if (!isRecord(raw)) {
    return { ok: false, code: "missing_usage", message: "usage object is missing" };
  }
  const breakdown = isRecord(raw["cache_creation"]) ? raw["cache_creation"] : undefined;
  const totalWrites = counter(raw["cache_creation_input_tokens"]);
  const writes1h = breakdown === undefined ? 0 : counter(breakdown["ephemeral_1h_input_tokens"]);
  const explained5m = breakdown === undefined ? 0 : counter(breakdown["ephemeral_5m_input_tokens"]);
  const unexplained = Math.max(0, totalWrites - explained5m - writes1h);
  try {
    const usage = makeUsage({
      inputTokens: counter(raw["input_tokens"]),
      outputTokens: counter(raw["output_tokens"]),
      cacheReadTokens: counter(raw["cache_read_input_tokens"]),
      cacheWrite5mTokens: explained5m + unexplained,
      cacheWrite1hTokens: writes1h,
    });
    return { ok: true, usage };
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid usage";
    return { ok: false, code: "invalid_usage", message };
  }
}
