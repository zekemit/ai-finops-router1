import { formatPct, formatUsd } from "@ai-finops/interceptor";
import type { ReactNode } from "react";
import { AGENT_COLOR, AGENT_NAME, headlineUsd } from "../lib/labels";
import type { Kpis } from "../lib/view-model";

function Card({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`flex min-w-0 flex-col rounded-xl border border-rule bg-surface p-5 ${className}`}>
      <h2 className="text-[13px] font-medium text-ink-2">{title}</h2>
      {children}
    </section>
  );
}

const FIGURE = "num text-[44px] font-semibold leading-none tracking-tight";

interface Segment {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

/** Touching marks are separated by a 2px gap of surface colour, never by a border. */
function SplitBar({ segments, label }: { segments: readonly Segment[]; label: string }) {
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div role="img" aria-label={label} className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-[3px]">
      {visible.map((s) => (
        <span key={s.key} title={`${s.label}: ${headlineUsd(s.value)}`} className="block min-w-[2px]" style={{ flex: `${s.value} 1 0`, background: s.color }} />
      ))}
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="mt-[5px] block size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />;
}

function TotalSpend({ kpis }: { kpis: Kpis }) {
  const agents = kpis.summary.byAgent;
  return (
    <Card title="Total spend">
      <p className={`${FIGURE} mt-3`}>{headlineUsd(kpis.totalSpendUsd)}</p>
      <p className="mt-2 text-sm text-ink-2">{kpis.summary.calls} model calls billed</p>
      <div className="mt-5">
        <SplitBar
          label="Spend by agent"
          segments={agents.map((a) => ({ key: a.agent, label: AGENT_NAME[a.agent], value: a.costUsd, color: AGENT_COLOR[a.agent] }))}
        />
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {agents.map((a) => (
          <li key={a.agent} className="flex items-start gap-2">
            <Swatch color={AGENT_COLOR[a.agent]} />
            <span className="min-w-0 flex-1 truncate">{AGENT_NAME[a.agent]}</span>
            <span className="num text-ink-2">{headlineUsd(a.costUsd)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Comparison({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const width = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div>
      <p className="text-sm text-ink-2">{label}</p>
      <div className="mt-1 grid grid-cols-[1fr_auto] items-center gap-3">
        <span aria-hidden className="block h-2.5 rounded-[3px] bg-rule/70">
          <span className="block h-full rounded-[3px]" style={{ width: `${width}%`, background: color }} />
        </span>
        <span className="num w-14 text-right text-sm font-medium">{headlineUsd(value)}</span>
      </div>
    </div>
  );
}

function CostPerFeature({ kpis }: { kpis: Kpis }) {
  const paid = kpis.costPerFeatureUsd;
  const without = kpis.counterfactualPerFeatureUsd;
  return (
    <Card title="Cost per feature shipped">
      <p className={`${FIGURE} mt-3`}>{paid === null ? "–" : headlineUsd(paid)}</p>
      <p className="mt-2 text-sm text-ink-2">
        {kpis.featuresShipped} {kpis.featuresShipped === 1 ? "feature" : "features"} shipped
      </p>
      {paid !== null && without !== null ? (
        <div className="mt-5 space-y-3">
          <Comparison label="What it cost" value={paid} max={without} color="var(--ink)" />
          <Comparison label="Without caching and scripts" value={without} max={without} color="var(--without)" />
        </div>
      ) : (
        <p className="mt-5 text-sm text-ink-2">Ships appear here once a Release agent approves its first feature.</p>
      )}
    </Card>
  );
}

function Savings({ kpis }: { kpis: Kpis }) {
  const s = kpis.savings;
  const rate = kpis.offloads.offloadRate;
  return (
    <Card title="Saved by caching and scripts" className="border-t-[3px] border-t-saved-fill">
      <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-2">
        <p className={`${FIGURE} text-saved`}>{headlineUsd(s.totalSavingsUsd)}</p>
        <p className={`${FIGURE} text-saved`}>{formatPct(s.totalSavingsPct)}</p>
      </div>
      <p className="mt-2 text-sm text-ink-2">
        {rate === null ? "of what this work would have cost" : `of what this work would have cost; ${formatPct(rate)} of tasks never reached a model`}
      </p>
      <div className="mt-5">
        <SplitBar
          label="The no-optimisation bill, split into what was paid and what each saving removed"
          segments={[
            { key: "paid", label: "Paid", value: s.actualUsd, color: "var(--ink)" },
            { key: "cache", label: "Prompt caching", value: s.cacheSavingsUsd, color: "var(--saved-fill)" },
            { key: "scripts", label: "Local scripts", value: s.offloadSavingsUsd, color: "color-mix(in srgb, var(--saved-fill) 45%, var(--surface))" },
          ]}
        />
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        <li className="flex items-start gap-2">
          <Swatch color="var(--ink)" />
          <span className="flex-1">Paid</span>
          <span className="num text-ink-2">{headlineUsd(s.actualUsd)}</span>
        </li>
        <li className="flex items-start gap-2">
          <Swatch color="var(--saved-fill)" />
          <span className="flex-1">Prompt caching</span>
          <span className="num text-ink-2">{headlineUsd(s.cacheSavingsUsd)}</span>
        </li>
        <li className="flex items-start gap-2">
          <Swatch color="color-mix(in srgb, var(--saved-fill) 45%, var(--surface))" />
          <span className="flex-1">Local scripts</span>
          <span className="num text-ink-2">{headlineUsd(s.offloadSavingsUsd)}</span>
        </li>
      </ul>
    </Card>
  );
}

function BurnRate({ kpis }: { kpis: Kpis }) {
  const { burn } = kpis;
  const max = Math.max(0, ...burn.byAgent.map((a) => a.usdPerMinute));
  return (
    <Card title="Active subagent burn rate">
      <p className={`${FIGURE} mt-3`}>
        {formatUsd(burn.usdPerMinute)}
        <span className="ml-1 text-xl font-medium text-ink-2">/min</span>
      </p>
      <p className="mt-2 flex items-center gap-2 text-sm text-ink-2">
        <span aria-hidden className={`block size-2 rounded-full ${burn.live ? "beat bg-saved-fill" : "bg-without"}`} />
        {burn.live ? "Live, last 60 seconds" : "Last minute of recorded activity"}
      </p>
      <div className="mt-5 space-y-2.5">
        {burn.byAgent.length === 0 ? (
          <p className="text-sm text-ink-2">No agent has called a model in the last minute.</p>
        ) : (
          burn.byAgent.map((a) => (
            <div key={a.agent} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate">{AGENT_NAME[a.agent]}</span>
              <span aria-hidden className="block h-2.5 rounded-[3px] bg-rule/70">
                <span className="block h-full rounded-[3px]" style={{ width: `${max > 0 ? Math.max(3, (a.usdPerMinute / max) * 100) : 0}%`, background: AGENT_COLOR[a.agent] }} />
              </span>
              <span className="num w-14 text-right text-ink-2">{formatUsd(a.usdPerMinute)}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

export function KpiStrip({ kpis }: { kpis: Kpis }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.3fr_1fr]">
      <TotalSpend kpis={kpis} />
      <CostPerFeature kpis={kpis} />
      <Savings kpis={kpis} />
      <BurnRate kpis={kpis} />
    </div>
  );
}
