/**
 * Anthropic per-model pricing, in USD per million tokens (MTok).
 *
 * Source: the Claude API reference bundled with Claude Code (price table cached 2026-11-03).
 * Verify against https://platform.claude.com/docs/en/about-claude/pricing before relying
 * on these for invoicing; pass your own `PricingTable` to override.
 *
 * Cache-write rates follow the documented multipliers: 5-minute write = 1.25x input,
 * 1-hour write = 2x input (e.g. Fable 5.2: $8 input -> $10 / $16 writes).
 * Cache-read rates are model-specific (0.025x - 0.1x of input), so they are explicit data.
 */

export interface ModelPricing {
  /** Canonical model id, e.g. `claude-sonnet-5-5`. */
  readonly model: string;
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
  readonly cacheReadPerMTok: number;
  readonly cacheWrite5mPerMTok: number;
  readonly cacheWrite1hPerMTok: number;
  /**
   * `documented`: every rate on this row is stated in the bundled docs.
   * `assumed`: input/output are documented but the cache-read rate is not; it is
   * assumed to be the standard 0.1x of input. Surface this to users.
   */
  readonly source: "documented" | "assumed";
}

export type PricingTable = Readonly<Record<string, ModelPricing>>;

const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2;

function price(
  model: string,
  inputPerMTok: number,
  outputPerMTok: number,
  cacheReadPerMTok: number,
  source: ModelPricing["source"],
): ModelPricing {
  return {
    model,
    inputPerMTok,
    outputPerMTok,
    cacheReadPerMTok,
    cacheWrite5mPerMTok: inputPerMTok * CACHE_WRITE_5M_MULTIPLIER,
    cacheWrite1hPerMTok: inputPerMTok * CACHE_WRITE_1H_MULTIPLIER,
    source,
  };
}

const ENTRIES: readonly ModelPricing[] = [
  // --- Fully documented ---
  price("claude-fable-5-2", 8, 40, 0.2, "documented"),
  price("claude-mythos-5-2", 8, 40, 0.2, "documented"),
  price("claude-fable-5-1", 10, 50, 0.25, "documented"),
  price("claude-mythos-5-1", 10, 50, 0.25, "documented"),
  price("claude-fable-5", 10, 50, 1, "documented"),
  price("claude-mythos-5", 10, 50, 1, "documented"),
  price("claude-opus-5-5", 4, 20, 0.2, "documented"),
  price("claude-sonnet-5-5", 2, 10, 0.1, "documented"),
  // --- Input/output documented; cache-read assumed at 0.1x input ---
  price("claude-opus-4-8", 5, 25, 0.5, "assumed"),
  price("claude-opus-4-7", 5, 25, 0.5, "assumed"),
  price("claude-opus-4-6", 5, 25, 0.5, "assumed"),
  price("claude-sonnet-4-6", 3, 15, 0.3, "assumed"),
  price("claude-haiku-4-5", 1, 5, 0.1, "assumed"),
];

export const DEFAULT_PRICING: PricingTable = Object.freeze(
  Object.fromEntries(ENTRIES.map((entry) => [entry.model, entry])),
);

/**
 * Resolve a model id to pricing. Accepts exact ids, dated snapshots
 * (`claude-haiku-4-5-20251001`) and Claude Code context suffixes (`claude-opus-4-6[1m]`).
 * Returns `undefined` for unknown models; callers must surface that, never guess a price.
 */
export function resolvePricing(model: string, table: PricingTable = DEFAULT_PRICING): ModelPricing | undefined {
  const normalized = model.trim().replace(/\[[^\]]*\]$/, "");
  if (normalized === "") return undefined;
  const candidates = [normalized, normalized.replace(/-\d{8}$/, "")];
  for (const key of candidates) {
    // Object.hasOwn: a model named "constructor" must not resolve to Object.prototype members.
    if (Object.hasOwn(table, key)) return table[key];
  }
  return undefined;
}
