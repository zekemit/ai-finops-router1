import { formatPct, formatUsd } from "@ai-finops/interceptor";
import type { RunawayLoopAlert } from "@ai-finops/interceptor";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { clockLabel, headlineUsd } from "../lib/labels";
import type { SeriesPoint, SprintRow } from "../lib/view-model";

interface Datum {
  readonly atMs: number;
  readonly actualUsd: number;
  readonly withoutOptimizationUsd: number;
  /** The wedge between the two lines: what was saved so far. Never negative. */
  readonly gapUsd: number;
}

interface Props {
  readonly series: readonly SeriesPoint[];
  readonly alerts: readonly RunawayLoopAlert[];
  readonly sprints: readonly (SprintRow & { readonly startMs: number })[];
  readonly domain: readonly [number, number];
  readonly paidUsd: number;
  readonly withoutUsd: number;
}

const TICK_STEP_MS = 20 * 60_000;

function ticksFor([start, end]: readonly [number, number]): number[] {
  const ticks: number[] = [];
  for (let t = Math.ceil(start / TICK_STEP_MS) * TICK_STEP_MS; t <= end; t += TICK_STEP_MS) ticks.push(t);
  return ticks;
}

function ChartTooltip({ datum }: { datum: Datum }) {
  const saved = datum.withoutOptimizationUsd - datum.actualUsd;
  const pct = datum.withoutOptimizationUsd > 0 ? saved / datum.withoutOptimizationUsd : 0;
  return (
    <div className="rounded-lg border border-rule bg-surface px-3 py-2 text-sm shadow-sm">
      <p className="num font-medium">{clockLabel(datum.atMs)} simulated</p>
      <dl className="num mt-1 space-y-0.5">
        <div className="flex justify-between gap-6">
          <dt className="text-ink-2">Paid so far</dt>
          <dd>{formatUsd(datum.actualUsd)}</dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt className="text-ink-2">Without caching and scripts</dt>
          <dd>{formatUsd(datum.withoutOptimizationUsd)}</dd>
        </div>
        <div className="flex justify-between gap-6 text-saved">
          <dt>Saved</dt>
          <dd>
            {formatUsd(saved)} ({formatPct(pct)})
          </dd>
        </div>
      </dl>
    </div>
  );
}

function LegendValue({ swatch, label, value }: { swatch: "line-ink" | "line-slate" | "wedge"; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className="block w-6 shrink-0">
        {swatch === "wedge" ? (
          <span className="block h-3 rounded-[3px]" style={{ background: "color-mix(in srgb, var(--saved-fill) 32%, var(--surface))" }} />
        ) : (
          <span className="block h-[3px] rounded-full" style={{ background: swatch === "line-ink" ? "var(--ink)" : "var(--without)" }} />
        )}
      </span>
      <div>
        <p className="text-[13px] text-ink-2">{label}</p>
        <p className={`num text-2xl font-semibold leading-tight ${swatch === "wedge" ? "text-saved" : ""}`}>{value}</p>
      </div>
    </div>
  );
}

export function SpendChart({ series, alerts, sprints, domain, paidUsd, withoutUsd }: Props) {
  const data: Datum[] = series.map((p) => ({
    atMs: p.atMs,
    actualUsd: p.actualUsd,
    withoutOptimizationUsd: p.withoutOptimizationUsd,
    gapUsd: Math.max(0, p.withoutOptimizationUsd - p.actualUsd),
  }));
  const last = data[data.length - 1];
  const savedUsd = withoutUsd - paidUsd;
  const summary = `Paid ${headlineUsd(paidUsd)} against ${headlineUsd(withoutUsd)} without caching and scripts, saving ${headlineUsd(savedUsd)}.`;

  return (
    <figure className="min-w-0">
      <figcaption className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">What the same work would have cost</h2>
          <p className="mt-0.5 max-w-prose text-sm text-ink-2">
            Cumulative spend. The shaded wedge is money prompt caching and local scripts kept off the bill.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <LegendValue swatch="line-slate" label="Without caching and scripts" value={headlineUsd(withoutUsd)} />
          <LegendValue swatch="line-ink" label="Paid" value={headlineUsd(paidUsd)} />
          <LegendValue swatch="wedge" label="Saved" value={headlineUsd(savedUsd)} />
        </div>
      </figcaption>

      <div role="img" aria-label={summary} className="mt-4 h-[340px] w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={data} margin={{ top: 14, right: 18, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--rule)" />
            <XAxis
              type="number"
              dataKey="atMs"
              domain={[domain[0], domain[1]]}
              ticks={ticksFor(domain)}
              tickFormatter={clockLabel}
              tick={{ fill: "var(--ink-2)", fontSize: 12 }}
              axisLine={{ stroke: "var(--axis)" }}
              tickLine={false}
              allowDataOverflow
            />
            <YAxis tickFormatter={(v: number) => `$${Math.round(v)}`} tick={{ fill: "var(--ink-2)", fontSize: 12 }} axisLine={false} tickLine={false} width={44} />
            <Tooltip
              cursor={{ stroke: "var(--axis)" }}
              isAnimationActive={false}
              content={(props) => {
                const datum = props.payload?.[0]?.payload as Datum | undefined;
                return props.active === true && datum !== undefined ? <ChartTooltip datum={datum} /> : null;
              }}
            />

            {sprints.map((s) => (
              <ReferenceLine key={s.sessionId} x={s.startMs} stroke="var(--axis)" label={{ value: s.label, position: "insideTopLeft", fill: "var(--ink-2)", fontSize: 11 }} />
            ))}
            {alerts.map((a) => (
              <ReferenceLine
                key={`${a.sessionId}-${a.fingerprint}`}
                x={Date.parse(a.lastTimestamp)}
                stroke="var(--alert)"
                strokeWidth={1.5}
                label={{ value: "Loop caught", position: "insideBottomRight", fill: "var(--ink-2)", fontSize: 11 }}
              />
            ))}

            {/* The wedge: a transparent base stacked under the gap, so only the saving is tinted. */}
            <Area dataKey="actualUsd" stackId="saving" type="monotone" stroke="none" fill="none" isAnimationActive={false} activeDot={false} legendType="none" />
            <Area dataKey="gapUsd" stackId="saving" type="monotone" stroke="none" fill="var(--saved-fill)" fillOpacity={0.14} isAnimationActive={false} activeDot={false} />
            <Line dataKey="withoutOptimizationUsd" type="monotone" stroke="var(--without)" strokeWidth={2} dot={false} isAnimationActive={false} activeDot={false} />
            <Line dataKey="actualUsd" type="monotone" stroke="var(--ink)" strokeWidth={2.5} dot={false} isAnimationActive={false} activeDot={false} />

            {last !== undefined && (
              <>
                <ReferenceDot x={last.atMs} y={last.withoutOptimizationUsd} r={5} fill="var(--without)" stroke="var(--surface)" strokeWidth={2} />
                <ReferenceDot x={last.atMs} y={last.actualUsd} r={5} fill="var(--ink)" stroke="var(--surface)" strokeWidth={2} />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
