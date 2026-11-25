/**
 * The ROI model behind the live calculator.
 *
 * It is a thin layer over the interceptor's own cost engine (`calculateCost`), so the dollars on this page are
 * computed exactly the way the dashboard and the CLI compute them. Everything else is an explicit, visible
 * assumption: output tokens are 3% of prompt tokens, tokens that miss the cache are billed as 5-minute cache
 * writes (as in real Claude Code logs), and a scripted task is as expensive as an average one.
 */
import { calculateCost, makeUsage, resolvePricing } from "@ai-finops/interceptor";

export const ROI_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5"] as const;
export type RoiModel = (typeof ROI_MODELS)[number];

export interface RoiInputs {
  readonly agents: number;
  /** Prompt tokens each agent processes per day, in millions (cached or not). */
  readonly dailyTokensM: number;
  /** Share of prompt tokens read from the prompt cache. */
  readonly cacheHitRate: number;
  readonly model: RoiModel;
  /** Share of tasks a local script answers instead of the model. */
  readonly mechanicalShare: number;
  /** What one agent-day of work is worth to you, in dollars. Revenue for the margin lines. */
  readonly valuePerAgentDayUsd: number;
}

type NumericField = Exclude<keyof RoiInputs, "model">;

export const ROI_LIMITS: Readonly<Record<NumericField, { readonly min: number; readonly max: number; readonly step: number }>> = {
  agents: { min: 1, max: 200, step: 1 },
  dailyTokensM: { min: 0.1, max: 50, step: 0.1 },
  cacheHitRate: { min: 0, max: 0.99, step: 0.01 },
  mechanicalShare: { min: 0, max: 0.6, step: 0.01 },
  valuePerAgentDayUsd: { min: 0, max: 2_000, step: 10 },
};

export const DEFAULT_ROI_INPUTS: RoiInputs = {
  agents: 12,
  dailyTokensM: 20,
  cacheHitRate: 0.95,
  model: "claude-sonnet-5-5",
  mechanicalShare: 0.35,
  valuePerAgentDayUsd: 120,
};

/** Output tokens as a share of prompt tokens. Real agent loops sit between 1% and 4%. */
export const OUTPUT_TOKEN_RATIO = 0.03;
export const DAYS_PER_MONTH = 30;
const SECONDS_PER_DAY = 86_400;

export interface SpendBreakdown {
  /** No caching, no scripts: every prompt token at the plain input rate. */
  readonly baselineUsd: number;
  /** With prompt caching only. */
  readonly cachedUsd: number;
  /** With prompt caching and scripts: what you would actually pay. */
  readonly optimizedUsd: number;
  /** `baseline - cached`. Negative when the hit rate is too low for caching to pay. */
  readonly cacheSavingsUsd: number;
  /** The share of the cached bill that scripts keep off it. */
  readonly scriptSavingsUsd: number;
  readonly totalSavingsUsd: number;
  /** `totalSavingsUsd / baselineUsd`; negative when caching costs more than it saves. */
  readonly savingsPct: number;
}

export interface RoiResult {
  readonly inputs: RoiInputs;
  readonly tokensPerDay: { readonly prompt: number; readonly cacheRead: number; readonly cacheWrite: number; readonly output: number };
  readonly daily: SpendBreakdown;
  readonly monthly: SpendBreakdown;
  /** `baseline / optimized`, e.g. 4.5 means 4.5x cheaper. Null if optimized spend is zero. */
  readonly costMultiplier: number | null;
  readonly revenueMonthlyUsd: number;
  /** Ratios in [-inf, 1]. All null when revenue is zero. */
  readonly grossMargin: { readonly withoutPct: number | null; readonly withPct: number | null; readonly gainPoints: number | null };
  /** Margin with / margin without. Null unless the unoptimised margin is positive. */
  readonly marginMultiplier: number | null;
  readonly perAgentDayUsd: { readonly baseline: number; readonly optimized: number };
  readonly savedPerSecondUsd: number;
  /** Cache hit rate below which caching costs more than it saves, from the model's own price ratios. */
  readonly cacheBreakEvenHitRate: number;
}

function decimals(step: number): number {
  const text = String(step);
  return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
}

/** Turn arbitrary UI values into valid inputs: bad values fall back to the default, the rest is clamped and snapped to its step. */
export function normalizeInputs(raw: Partial<Record<keyof RoiInputs, unknown>>): RoiInputs {
  const numeric = (field: NumericField): number => {
    const value = raw[field];
    const { min, max, step } = ROI_LIMITS[field];
    if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_ROI_INPUTS[field];
    const clamped = Math.min(max, Math.max(min, value));
    const snapped = Math.round((clamped - min) / step) * step + min;
    return Math.min(max, Math.max(min, Number(snapped.toFixed(decimals(step)))));
  };
  const model = ROI_MODELS.find((candidate) => candidate === raw.model) ?? DEFAULT_ROI_INPUTS.model;
  return {
    agents: numeric("agents"),
    dailyTokensM: numeric("dailyTokensM"),
    cacheHitRate: numeric("cacheHitRate"),
    model,
    mechanicalShare: numeric("mechanicalShare"),
    valuePerAgentDayUsd: numeric("valuePerAgentDayUsd"),
  };
}

function validate(inputs: RoiInputs): void {
  for (const field of Object.keys(ROI_LIMITS) as NumericField[]) {
    const value = inputs[field];
    const { min, max } = ROI_LIMITS[field];
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new RangeError(`${field} must be between ${min} and ${max}, received ${String(value)}`);
    }
  }
  if (!Number.isInteger(inputs.agents)) throw new RangeError(`agents must be a whole number, received ${String(inputs.agents)}`);
  if (!ROI_MODELS.includes(inputs.model)) throw new RangeError(`model must be one of ${ROI_MODELS.join(", ")}, received ${String(inputs.model)}`);
}

function scale(day: SpendBreakdown, factor: number): SpendBreakdown {
  return {
    baselineUsd: day.baselineUsd * factor,
    cachedUsd: day.cachedUsd * factor,
    optimizedUsd: day.optimizedUsd * factor,
    cacheSavingsUsd: day.cacheSavingsUsd * factor,
    scriptSavingsUsd: day.scriptSavingsUsd * factor,
    totalSavingsUsd: day.totalSavingsUsd * factor,
    savingsPct: day.savingsPct,
  };
}

export function computeRoi(inputs: RoiInputs): RoiResult {
  validate(inputs);
  const pricing = resolvePricing(inputs.model);
  if (pricing === undefined) throw new RangeError(`no pricing for ${inputs.model}`);

  const prompt = Math.round(inputs.agents * inputs.dailyTokensM * 1_000_000);
  const cacheRead = Math.round(prompt * inputs.cacheHitRate);
  const cacheWrite = prompt - cacheRead;
  const output = Math.round(prompt * OUTPUT_TOKEN_RATIO);

  const cost = calculateCost(makeUsage({ outputTokens: output, cacheReadTokens: cacheRead, cacheWrite5mTokens: cacheWrite }), pricing);

  const scriptSavingsUsd = cost.totalUsd * inputs.mechanicalShare;
  const optimizedUsd = cost.totalUsd - scriptSavingsUsd;
  const totalSavingsUsd = cost.baselineUsd - optimizedUsd;
  const daily: SpendBreakdown = {
    baselineUsd: cost.baselineUsd,
    cachedUsd: cost.totalUsd,
    optimizedUsd,
    cacheSavingsUsd: cost.baselineUsd - cost.totalUsd,
    scriptSavingsUsd,
    totalSavingsUsd,
    savingsPct: cost.baselineUsd === 0 ? 0 : totalSavingsUsd / cost.baselineUsd,
  };
  const monthly = scale(daily, DAYS_PER_MONTH);

  const revenueMonthlyUsd = inputs.agents * inputs.valuePerAgentDayUsd * DAYS_PER_MONTH;
  const withoutPct = revenueMonthlyUsd > 0 ? (revenueMonthlyUsd - monthly.baselineUsd) / revenueMonthlyUsd : null;
  const withPct = revenueMonthlyUsd > 0 ? (revenueMonthlyUsd - monthly.optimizedUsd) / revenueMonthlyUsd : null;

  const readRatio = pricing.cacheReadPerMTok / pricing.inputPerMTok;
  const writeRatio = pricing.cacheWrite5mPerMTok / pricing.inputPerMTok;

  return {
    inputs,
    tokensPerDay: { prompt, cacheRead, cacheWrite, output },
    daily,
    monthly,
    costMultiplier: optimizedUsd > 0 ? cost.baselineUsd / optimizedUsd : null,
    revenueMonthlyUsd,
    grossMargin: { withoutPct, withPct, gainPoints: withoutPct !== null && withPct !== null ? withPct - withoutPct : null },
    marginMultiplier: withoutPct !== null && withPct !== null && withoutPct > 0 ? withPct / withoutPct : null,
    perAgentDayUsd: { baseline: cost.baselineUsd / inputs.agents, optimized: optimizedUsd / inputs.agents },
    savedPerSecondUsd: totalSavingsUsd / SECONDS_PER_DAY,
    cacheBreakEvenHitRate: (writeRatio - 1) / (writeRatio - readRatio),
  };
}
