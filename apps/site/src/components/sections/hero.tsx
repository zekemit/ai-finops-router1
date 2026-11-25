"use client";

import { useReducedMotion } from "motion/react";
import { Rocket } from "lucide-react";
import type { CSSProperties } from "react";
import { Button, LinkButton } from "../ui/button";
import { Pill } from "../ui/pill";
import { usdFine } from "../../lib/format";
import { useElapsedSeconds } from "../../lib/hooks";
import type { RepoFacts } from "../../lib/repo-facts";
import type { RoiResult } from "../../lib/roi";

interface Props {
  readonly facts: RepoFacts;
  readonly result: RoiResult;
  readonly onDeploy: () => void;
}

const step = (n: number): CSSProperties => ({ "--i": n }) as CSSProperties;

function Readout({ label, value, caption, tone = "text-ink" }: { label: string; value: string; caption: string; tone?: string }) {
  return (
    <div className="glass hud rounded-2xl p-5 text-left">
      <p className="text-[13px] text-ink-3">{label}</p>
      <p className={`mono mt-2 text-[2rem] font-medium leading-none ${tone}`}>{value}</p>
      <p className="mt-3 text-[13px] leading-snug text-ink-3">{caption}</p>
    </div>
  );
}

export function Hero({ facts, result, onDeploy }: Props) {
  const reduce = useReducedMotion();
  const elapsed = useElapsedSeconds(reduce === true ? 1_000 : 100);
  const allGreen = facts.failed === 0;

  return (
    <section id="top" aria-labelledby="hero-title" className="relative isolate overflow-hidden px-6 pb-24 pt-16 md:pt-24">
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_-5%,rgb(6_182_212/0.22),transparent_70%),radial-gradient(ellipse_40%_35%_at_85%_55%,rgb(52_211_153/0.09),transparent_70%)]" />
        <div className="backdrop-grid absolute inset-0" />
      </div>

      <div className="mx-auto max-w-5xl text-center">
        <div className="rise flex flex-wrap items-center justify-center gap-2.5" style={step(0)}>
          <Pill live>Routing live</Pill>
          <Pill>
            <span className="mono text-ink">{facts.passed}</span> of <span className="mono text-ink">{facts.total}</span> tests {allGreen ? "passing" : "passed"}
          </Pill>
          <Pill>
            <span className="mono text-ink">{facts.models}</span> models priced
          </Pill>
          <Pill>
            <span className="mono text-ink">{facts.rules}</span> offload rules
          </Pill>
        </div>

        <h1
          id="hero-title"
          className="rise mx-auto mt-8 max-w-5xl bg-gradient-to-b from-white to-[#9ba7b4] bg-clip-text text-[clamp(2.5rem,6.4vw,4.75rem)] font-semibold leading-[1.04] tracking-[-0.04em] text-transparent"
          style={step(1)}
        >
          <span className="block text-balance">Know what every agent costs.</span>
          <span className="block text-balance">Stop paying for what a script can answer.</span>
        </h1>

        <p className="rise mx-auto mt-7 max-w-2xl text-pretty text-lg leading-relaxed text-ink-2 md:text-xl" style={step(2)}>
          ai-finops-router reads your Claude Code logs, prices every call to the cent, and answers mechanical tasks locally before they reach a model.
        </p>

        <div className="rise mt-10 flex flex-wrap items-center justify-center gap-3" style={step(3)}>
          <Button variant="primary" onClick={onDeploy}>
            <Rocket aria-hidden className="size-[18px]" />
            Deploy Router
          </Button>
          <LinkButton href="#architecture" variant="glass">
            Explore Monorepo
          </LinkButton>
        </div>

        <div className="rise mx-auto mt-16 grid max-w-4xl gap-3 sm:grid-cols-3" style={step(4)}>
          <Readout
            label="Saved since you opened this page"
            value={usdFine(result.savedPerSecondUsd * elapsed)}
            caption="Modelled from the calculator below, at its current settings."
            tone="text-emerald"
          />
          <Readout label="Overcount removed" value="4.2x" caption="One real session: $13.61 when every log line is summed, $3.21 billed." />
          <Readout label="Model calls for mechanical tasks" value="0" caption="Lint, JSON, search and test summaries run as local scripts." />
        </div>
      </div>
    </section>
  );
}
