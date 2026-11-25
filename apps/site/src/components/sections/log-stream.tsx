"use client";

import { Check, Pause, Play, RotateCcw, TriangleAlert } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "../ui/button";
import { Segmented } from "../ui/segmented";
import { SectionHeader } from "./section-header";
import { clock, compact, int, usd, usdFine } from "../../lib/format";
import { useInView } from "../../lib/hooks";
import { generateStream } from "../../lib/logstream";
import type { StreamStep } from "../../lib/logstream";
import { advance, initialStream } from "../../lib/stream-engine";
import type { FeedRow, StreamState } from "../../lib/stream-engine";

const CALLS = 30;
const VISIBLE_ROWS = 13;
const BASE_INTERVAL_MS = 380;

type Mode = "auto" | "play" | "pause";
type Speed = "1" | "3";

const VERDICT: Record<FeedRow["kind"], { label: string; chip: string }> = {
  new: { label: "new", chip: "bg-white/10 text-ink" },
  dup: { label: "dup", chip: "bg-white/[0.05] text-ink-3" },
  script: { label: "script", chip: "bg-emerald/10 text-emerald" },
};

function Row({ row, raw }: { row: FeedRow; raw: boolean }) {
  const verdict = VERDICT[row.kind];
  const shortKey = row.key.split("|")[0]?.slice(0, 14) ?? row.key;
  let amount: ReactNode;
  if (row.kind === "new") amount = <span>{usdFine(row.usd)}</span>;
  else if (row.kind === "dup") {
    amount = (
      <span className="text-ink-3 line-through decoration-1">
        {usdFine(row.naiveUsd)}
        <span className="sr-only"> not billed</span>
      </span>
    );
  } else {
    amount = (
      <span className="text-emerald">
        +{usdFine(row.usd)}
        <span className="sr-only"> saved</span>
      </span>
    );
  }

  return (
    <li className="row-in grid grid-cols-[4.25rem_3.75rem_minmax(0,1fr)_auto] items-start gap-x-3 border-b border-white/[0.06] px-4 py-2 text-[13px] leading-5 last:border-b-0 max-sm:grid-cols-[3.75rem_minmax(0,1fr)_auto]">
      <span className="mono text-ink-3 max-sm:hidden">{clock(row.atMs)}</span>
      <span className={`mono inline-flex justify-center rounded-md px-1.5 py-px text-xs ${verdict.chip}`}>{verdict.label}</span>
      <span className="min-w-0">
        {row.kind === "script" ? (
          <span className="block truncate text-ink-2">{row.title}</span>
        ) : (
          <span className="mono flex min-w-0 text-ink-2">
            <span className="truncate">{shortKey}</span>
            <span className="shrink-0 whitespace-pre text-ink-3"> block {row.block}</span>
          </span>
        )}
        {raw && row.raw !== null && <span className="mono mt-0.5 block truncate text-xs text-ink-3">{row.raw}</span>}
      </span>
      <span className="mono text-right">{amount}</span>
    </li>
  );
}

function CompareBar({ label, icon, value, max, color }: { label: string; icon: ReactNode; value: number; max: number; color: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[15px]">
        <span className="flex items-center gap-2 text-ink-2">
          {icon}
          {label}
        </span>
        <span className="mono">{usd(value)}</span>
      </div>
      <span aria-hidden className="mt-2 block h-2.5 overflow-hidden rounded-[4px] bg-white/[0.07]">
        <span className="block h-full rounded-[4px] transition-[width] duration-500 ease-[var(--spring)]" style={{ width: `${max > 0 ? Math.max(1.5, (value / max) * 100) : 0}%`, background: color }} />
      </span>
    </div>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-[13px] text-ink-3">{label}</p>
      <p className={`mono mt-1 text-2xl font-medium leading-none ${tone}`}>{value}</p>
    </div>
  );
}

/** The terminal opens with the session already under way, so it is never empty before it scrolls into view. */
const PRELOAD_STEPS = 9;
const opening = (steps: readonly StreamStep[]): StreamState => advance(initialStream(steps), PRELOAD_STEPS);

export function LogStream() {
  const reduce = useReducedMotion();
  const steps = useMemo(() => generateStream(2026, CALLS), []);
  const [state, setState] = useState(() => opening(steps));
  const [mode, setMode] = useState<Mode>("auto");
  const [speed, setSpeed] = useState<Speed>("1");
  const [raw, setRaw] = useState(false);
  const [ref, inView] = useInView<HTMLElement>();

  const running = !state.done && inView && (mode === "play" || (mode === "auto" && reduce !== true));

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setState((s) => advance(s)), Math.round(BASE_INTERVAL_MS / Number(speed)));
    return () => window.clearInterval(timer);
  }, [running, speed]);

  const { stats } = state;
  const restart = (): void => {
    setState(opening(steps));
    setMode("play");
  };
  const summary = `Stream finished. ${int(stats.rawLines)} log lines collapsed into ${int(stats.uniqueCalls)} billed calls. Summing the lines says ${usd(stats.naiveUsd)}; the actual bill is ${usd(stats.correctUsd)}. ${int(stats.offloaded)} tasks were answered by scripts, saving ${usd(stats.savedUsd)}.`;

  return (
    <section id="stream" ref={ref} aria-labelledby="stream-title" className="mx-auto max-w-6xl px-6 py-24">
      <SectionHeader id="stream-title" title="Watch the parser collapse duplicates">
        A simulated Claude Code session, read by the real interceptor. Every call is logged once per content block. The parser keeps one line per call and prices it once.
      </SectionHeader>

      <div className="mt-12 grid grid-cols-12 gap-4">
        <div className="glass hud col-span-12 overflow-hidden rounded-3xl lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <p className="flex items-center gap-2.5 text-sm text-ink-2">
              <span aria-hidden className={`size-2 rounded-full ${running ? "beat bg-cyan" : "bg-ink-3"}`} />
              <span className="mono">session stream-demo</span>
              <span className="text-ink-3">{running ? "streaming" : state.done ? "finished" : "paused"}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {state.done ? (
                <Button size="sm" variant="primary" onClick={restart}>
                  <RotateCcw aria-hidden className="size-4" />
                  Replay
                </Button>
              ) : (
                <Button size="sm" variant="glass" onClick={() => setMode(running ? "pause" : "play")} aria-pressed={running}>
                  {running ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
                  {running ? "Pause" : "Play"}
                </Button>
              )}
              <Segmented
                label="Stream speed"
                value={speed}
                options={[
                  { value: "1", label: "1x" },
                  { value: "3", label: "3x" },
                ]}
                onChange={setSpeed}
              />
              <Button size="sm" variant="glass" aria-pressed={raw} onClick={() => setRaw((r) => !r)} className={raw ? "!bg-white/15" : ""}>
                Raw JSONL
              </Button>
            </div>
          </div>

          <ul aria-label="Parsed log lines, newest first" className="h-[27.5rem] overflow-hidden" tabIndex={0}>
            {state.rows.length === 0 ? (
              <li className="px-4 py-6 text-sm text-ink-3">Waiting for the first line. Press Play, or scroll here to start.</li>
            ) : (
              state.rows.slice(0, VISIBLE_ROWS).map((row) => <Row key={row.id} row={row} raw={raw} />)
            )}
          </ul>
          <p className="border-t border-white/10 px-4 py-3 text-[13px] text-ink-3">
            <span className="mono text-ink-2">new</span> is a call billed once. <span className="mono text-ink-2">dup</span> repeats a call already counted, so it costs nothing. <span className="mono text-emerald">script</span> was answered locally and never reached a model.
          </p>
        </div>

        <div role="group" aria-label="Stream totals" className="panel col-span-12 flex flex-col gap-6 rounded-3xl p-6 sm:p-8 lg:col-span-4">
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Log lines" value={int(stats.rawLines)} />
            <Stat label="Billed calls" value={int(stats.uniqueCalls)} />
            <Stat label="Collapsed" value={int(stats.duplicatesCollapsed)} />
          </div>

          <div className="space-y-4 border-t border-white/10 pt-6">
            <CompareBar label="Summing every line says" icon={<TriangleAlert aria-hidden className="size-4 text-critical" />} value={stats.naiveUsd} max={stats.naiveUsd} color="#eb6263" />
            <CompareBar label="Actually billed" icon={<Check aria-hidden className="size-4 text-ink" />} value={stats.correctUsd} max={stats.naiveUsd} color="#e6edf3" />
            <p className="text-[15px] text-ink-2">
              {stats.overcountFactor === null ? "Nothing billed yet." : <>The naive total is <span className="mono text-critical">{stats.overcountFactor.toFixed(1)}x</span> too high.</>}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-5 border-t border-white/10 pt-6">
            <Stat label="Tasks answered by scripts" value={`${int(stats.offloaded)} of ${int(stats.tasksSeen)}`} />
            <Stat label="Saved by scripts" value={usdFine(stats.savedUsd)} tone="text-emerald" />
            <Stat label="Tokens the model processed" value={compact(stats.llmTokens)} />
            <Stat label="Tokens it never saw" value={compact(stats.avoidedTokens)} tone="text-emerald" />
          </div>
          <p className="mt-auto text-[13px] leading-snug text-ink-3">Simulated data. Parsing, pricing and routing are the real packages. Tokens never seen counts the prompt, attached data and answer of each scripted task.</p>
        </div>
      </div>

      <p role="status" className="sr-only">
        {state.done ? summary : ""}
      </p>
    </section>
  );
}
