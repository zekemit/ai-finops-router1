"use client";

import { useEffect, useMemo, useReducer } from "react";
import { initialPlayback, playbackReducer } from "../lib/playback";
import { sprintStart } from "../lib/scenario";
import { computeKpis, spendSeries, sprintRows } from "../lib/view-model";
import { AgentTable } from "./agent-table";
import { KpiStrip } from "./kpi-strip";
import { LiveFeed } from "./live-feed";
import { LoopPanel } from "./loop-panel";
import { OffloadPanel } from "./offload-panel";
import { SimControls } from "./sim-controls";
import type { SprintProgress } from "./sim-controls";
import { SpendChart } from "./spend-chart";
import { SprintTable } from "./sprint-table";

const TICK_MS = 100;
const SPRINT_PADDING_MS = 45_000;

export function Dashboard({ initialSeed }: { initialSeed: number }) {
  const [state, dispatch] = useReducer(playbackReducer, initialSeed, initialPlayback);
  const running = state.status === "running";
  const streaming = running || state.status === "paused";

  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      dispatch({ type: "tick", realMs: now - last });
      last = now;
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [running]);

  const nowMs = streaming ? state.clockMs : null;
  const kpis = useMemo(() => computeKpis(state.engine, nowMs, running), [state.engine, nowMs, running]);
  const series = useMemo(() => spendSeries(state.engine), [state.engine]);
  const sprints = useMemo(() => sprintRows(state.engine), [state.engine]);

  const firstMs = Math.min(series[0]?.atMs ?? 0, sprintStart(0));
  const lastMs = series[series.length - 1]?.atMs ?? firstMs;
  const sprintEndMs = (state.timeline[state.timeline.length - 1]?.atMs ?? lastMs) + SPRINT_PADDING_MS;
  // While a sprint streams the axis is held at the sprint's full length, so the lines visibly grow into open space.
  const domain: readonly [number, number] = [firstMs, streaming ? Math.max(lastMs, sprintEndMs) : lastMs];

  const sprintStartMs = sprintStart(state.sprintIndex - 1);
  const progress: SprintProgress | null = streaming
    ? {
        fraction: Math.min(1, Math.max(0, (state.clockMs - sprintStartMs) / Math.max(1, sprintEndMs - sprintStartMs))),
        label: `Sprint ${state.sprintIndex}, simulated minute ${Math.max(0, Math.floor((state.clockMs - sprintStartMs) / 60_000))} of ${Math.ceil((sprintEndMs - sprintStartMs) / 60_000)}`,
      }
    : null;

  return (
    <main className="mx-auto w-full max-w-[1320px] px-4 pb-16 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5 py-7">
        <div className="min-w-0">
          <h1 className="text-[32px] font-bold leading-none tracking-tight">AI FinOps Router</h1>
          <p className="mt-2.5 max-w-xl text-[15px] text-ink-2">
            What a team of Claude Code agents costs to run, and how much prompt caching and local scripts keep off the bill.
          </p>
        </div>
        <SimControls
          state={state}
          dispatch={dispatch}
          progress={progress}
          onNewSeed={() => dispatch({ type: "reseed", seed: 1 + Math.floor(Math.random() * 9_000) })}
        />
      </header>

      <KpiStrip kpis={kpis} />

      <div className="mt-10 grid grid-cols-1 gap-x-10 gap-y-10 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <SpendChart
          series={series}
          alerts={state.engine.loopAlerts}
          sprints={sprints.map((row) => ({ ...row, startMs: sprintStart(Number(row.sessionId.replace("sprint-", ""))) }))}
          domain={domain}
          paidUsd={kpis.savings.actualUsd}
          withoutUsd={kpis.savings.counterfactualUsd}
        />
        <LiveFeed feed={state.engine.feed} live={running} />
      </div>

      <div className="mt-4">
        <SprintTable rows={sprints} />
      </div>

      <div className="mt-10 grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-2">
        <AgentTable kpis={kpis} />
        <div className="space-y-10">
          <OffloadPanel kpis={kpis} interceptedCalls={state.engine.interceptedCalls} />
          <LoopPanel engine={state.engine} sprints={sprints} />
        </div>
      </div>

      <footer className="mt-14 max-w-3xl border-t border-rule pt-5 text-[13px] leading-relaxed text-ink-2">
        <p>
          This is simulated data from a seeded generator, so every run with the same seed is identical. Spend uses Anthropic list prices per
          model, including the 5-minute and 1-hour cache-write tiers. Savings compare against the same work with no prompt caching and no
          local scripts. The router and loop detector are the real packages, running live on every simulated task.
        </p>
      </footer>
    </main>
  );
}
