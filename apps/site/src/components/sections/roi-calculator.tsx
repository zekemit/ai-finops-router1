"use client";

import { Info, RotateCcw, TriangleAlert } from "lucide-react";
import { useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { AnimatedNumber } from "../ui/animated-number";
import { Button } from "../ui/button";
import { RangeField } from "../ui/range-field";
import { Segmented } from "../ui/segmented";
import { SectionHeader } from "./section-header";
import { compact, int, pct, times, usd, usdFine } from "../../lib/format";
import { useElapsedSeconds } from "../../lib/hooks";
import { DEFAULT_ROI_INPUTS, DAYS_PER_MONTH, OUTPUT_TOKEN_RATIO, ROI_LIMITS, normalizeInputs } from "../../lib/roi";
import type { RoiInputs, RoiModel, RoiResult } from "../../lib/roi";

interface Props {
  readonly inputs: RoiInputs;
  readonly result: RoiResult;
  readonly onChange: (inputs: RoiInputs) => void;
}

const MODEL_OPTIONS: readonly { value: RoiModel; label: string }[] = [
  { value: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { value: "claude-opus-5-5", label: "Opus 5.5" },
];

function LiveSaved({ result }: { result: RoiResult }) {
  const reduce = useReducedMotion();
  const elapsed = useElapsedSeconds(reduce === true ? 1_000 : 100);
  return <span className="mono text-emerald">{usdFine(result.savedPerSecondUsd * elapsed)}</span>;
}

function Readout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[13px] text-ink-3">{label}</p>
      <p className="mono mt-1 text-xl">{children}</p>
    </div>
  );
}

function LedgerRow({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-6 py-3 ${strong ? "" : "border-b border-white/[0.07]"}`}>
      <dt className={strong ? "font-medium" : "text-ink-2"}>{label}</dt>
      <dd className={`mono text-right ${strong ? "text-lg font-medium" : ""}`}>{children}</dd>
    </div>
  );
}

export function RoiCalculator({ inputs, result, onChange }: Props) {
  const set = (patch: Partial<RoiInputs>): void => onChange(normalizeInputs({ ...inputs, ...patch }));
  const { monthly, daily } = result;
  const cacheLoses = monthly.cacheSavingsUsd < 0;
  const gm = result.grossMargin;

  const bar = [
    { key: "paid", label: "You pay", value: monthly.optimizedUsd, color: "#e6edf3" },
    { key: "cache", label: "Prompt caching keeps off the bill", value: Math.max(0, monthly.cacheSavingsUsd), color: "#34d399" },
    { key: "scripts", label: "Scripts keep off the bill", value: monthly.scriptSavingsUsd, color: "#a7f3d0" },
  ];

  return (
    <section id="roi" aria-labelledby="roi-title" className="mx-auto max-w-6xl px-6 py-24">
      <SectionHeader id="roi-title" title="Model your own bill">
        Move the sliders. Every dollar below comes from the same cost engine the command line uses, at Anthropic list prices.
      </SectionHeader>

      <div className="mt-12 grid grid-cols-12 gap-4">
        <div className="glass col-span-12 rounded-3xl p-6 sm:p-8 lg:col-span-5">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <h3 className="whitespace-nowrap text-lg font-semibold tracking-tight">Your fleet</h3>
            <Segmented label="Model" value={inputs.model} options={MODEL_OPTIONS} onChange={(model) => set({ model })} />
          </div>

          <div className="mt-8 space-y-7">
            <RangeField
              id="agents"
              label="Agents"
              {...ROI_LIMITS.agents}
              value={inputs.agents}
              display={int(inputs.agents)}
              onChange={(agents) => set({ agents })}
            />
            <RangeField
              id="tokens"
              label="Prompt tokens per agent per day"
              hint="Everything an agent sends to the model in a day, cached or not."
              {...ROI_LIMITS.dailyTokensM}
              value={inputs.dailyTokensM}
              display={`${inputs.dailyTokensM.toFixed(1)}M`}
              onChange={(dailyTokensM) => set({ dailyTokensM })}
            />
            <RangeField
              id="cache"
              label="Cache hit rate"
              hint={`Caching pays above ${pct(result.cacheBreakEvenHitRate, 0)}. Below that it costs more than not caching.`}
              {...ROI_LIMITS.cacheHitRate}
              value={inputs.cacheHitRate}
              display={pct(inputs.cacheHitRate, 0)}
              onChange={(cacheHitRate) => set({ cacheHitRate })}
            />
            <RangeField
              id="mechanical"
              label="Tasks a script can answer"
              hint="Lint, JSON, search and test summaries. Measure yours by running the command line over your own logs."
              {...ROI_LIMITS.mechanicalShare}
              value={inputs.mechanicalShare}
              display={pct(inputs.mechanicalShare, 0)}
              onChange={(mechanicalShare) => set({ mechanicalShare })}
            />
            <RangeField
              id="value"
              label="Value of one agent-day"
              hint="What a day of one agent's work is worth to you. It sets revenue for the margin lines."
              {...ROI_LIMITS.valuePerAgentDayUsd}
              value={inputs.valuePerAgentDayUsd}
              display={usd(inputs.valuePerAgentDayUsd)}
              onChange={(valuePerAgentDayUsd) => set({ valuePerAgentDayUsd })}
            />
          </div>

          <Button variant="ghost" size="sm" className="mt-6 -ml-3" onClick={() => onChange(DEFAULT_ROI_INPUTS)}>
            <RotateCcw aria-hidden className="size-4" />
            Reset to defaults
          </Button>
        </div>

        <div className="glass hud col-span-12 flex flex-col rounded-3xl p-6 sm:p-8 lg:col-span-7">
          <p className="text-[15px] text-ink-2">At these settings you would keep</p>
          <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-1">
            <p className="mono text-[clamp(2.75rem,7vw,4.5rem)] font-medium leading-none tracking-tight text-emerald" aria-live="off">
              <AnimatedNumber value={monthly.totalSavingsUsd} format={usd} />
            </p>
            <p className="pb-1.5 text-lg text-ink-2">
              a month, <span className="mono text-ink"><AnimatedNumber value={monthly.savingsPct} format={(v) => pct(v)} /></span> of the bill
            </p>
          </div>

          <div className="mt-8" role="img" aria-label={`Of a ${usd(monthly.baselineUsd)} monthly bill with no optimisation, you pay ${usd(monthly.optimizedUsd)}.`}>
            <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-[4px]">
              {bar.filter((s) => s.value > 0).map((s) => (
                <span key={s.key} className="block min-w-[2px] transition-[flex-grow] duration-500 ease-[var(--spring)]" style={{ flex: `${s.value} 1 0`, background: s.color }} />
              ))}
            </div>
          </div>
          <ul className="mt-4 grid gap-2 text-[15px] sm:grid-cols-3">
            {bar.map((s) => (
              <li key={s.key} className="flex items-start gap-2.5">
                <span aria-hidden className="mt-[7px] block size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
                <span>
                  <span className="block text-[13px] leading-snug text-ink-3">{s.label}</span>
                  <span className="mono">{usd(s.key === "cache" ? monthly.cacheSavingsUsd : s.value)}</span>
                </span>
              </li>
            ))}
          </ul>

          {cacheLoses && (
            <p role="status" className="mt-4 flex items-start gap-2.5 rounded-xl border border-critical/30 bg-critical/10 p-3.5 text-[15px]">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-critical" />
              <span>
                At a {pct(inputs.cacheHitRate, 0)} hit rate, caching costs <span className="mono">{usd(-monthly.cacheSavingsUsd)}</span> more a month than no caching. Every cache write carries a 25% premium that reads must earn back.
              </span>
            </p>
          )}

          <h3 className="mt-10 text-lg font-semibold tracking-tight">Monthly P&amp;L</h3>
          <dl className="mt-2 text-[15px]">
            <LedgerRow label={`Revenue (${int(inputs.agents)} agents × ${usd(inputs.valuePerAgentDayUsd)} × ${DAYS_PER_MONTH} days)`}>{usd(result.revenueMonthlyUsd)}</LedgerRow>
            <LedgerRow label="AI spend with no optimisation">{usd(monthly.baselineUsd)}</LedgerRow>
            <LedgerRow label="AI spend with caching and scripts">
              <AnimatedNumber value={monthly.optimizedUsd} format={usd} />
            </LedgerRow>
            <LedgerRow label="Gross margin before">{gm.withoutPct === null ? "n/a" : pct(gm.withoutPct)}</LedgerRow>
            <LedgerRow label="Gross margin after">
              {gm.withPct === null ? "n/a" : <AnimatedNumber value={gm.withPct} format={(v) => pct(v)} />}
            </LedgerRow>
            <LedgerRow label="Gross margin multiplier" strong>
              {result.marginMultiplier === null ? "n/a" : <AnimatedNumber value={result.marginMultiplier} format={(v) => `${v.toFixed(2)}x`} />}
            </LedgerRow>
            <LedgerRow label="Cost multiplier" strong>
              {result.costMultiplier === null ? "n/a" : <AnimatedNumber value={result.costMultiplier} format={times} />}
            </LedgerRow>
          </dl>

          <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-white/10 pt-6 sm:grid-cols-4">
            <Readout label="Spend per minute">{usdFine(daily.optimizedUsd / 1_440)}</Readout>
            <Readout label="Saved per minute">
              <span className="text-emerald">{usdFine(daily.totalSavingsUsd / 1_440)}</span>
            </Readout>
            <Readout label="Tokens a day">{compact(result.tokensPerDay.prompt)}</Readout>
            <Readout label="Saved since you opened this page">
              <LiveSaved result={result} />
            </Readout>
          </div>

          <details className="mt-8 text-[14px] text-ink-3">
            <summary className="flex min-h-10 cursor-pointer items-center gap-2 text-ink-2 hover:text-ink">
              <Info aria-hidden className="size-4" />
              How this is modelled
            </summary>
            <ul className="mt-2 list-disc space-y-1.5 pl-9 leading-relaxed">
              <li>Prices are Anthropic list prices, read from the interceptor&apos;s price table. This is a model, not a quote.</li>
              <li>Output tokens are {pct(OUTPUT_TOKEN_RATIO, 0)} of prompt tokens.</li>
              <li>Prompt tokens that miss the cache are billed as 5-minute cache writes, which is how real Claude Code logs look.</li>
              <li>A scripted task is assumed to cost as much as an average task, so scripts remove their share of the cached bill.</li>
              <li>A month is {DAYS_PER_MONTH} days. Margin counts AI spend only, not salaries or infrastructure.</li>
            </ul>
          </details>
        </div>
      </div>
    </section>
  );
}
