"use client";

import { ChevronRight, FileJson, FileSearch, ListChecks, SearchCode } from "lucide-react";
import Image from "next/image";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { Button } from "../ui/button";
import { SectionHeader } from "./section-header";
import type { RepoFacts } from "../../lib/repo-facts";

interface Props {
  readonly facts: RepoFacts;
  readonly onEngineering: () => void;
}

function Card({ className, children, hud = false }: { className: string; children: ReactNode; hud?: boolean }) {
  return (
    <motion.article
      className={`glass ${hud ? "hud" : ""} flex flex-col rounded-3xl p-6 will-change-transform sm:p-8 ${className}`}
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
    >
      {children}
    </motion.article>
  );
}

function PackageLabel({ path, facts, name }: { path: string; facts: RepoFacts; name: string }) {
  const pkg = facts.packages.find((p) => p.name === name);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <p className="mono text-[13px] text-cyan">{path}</p>
      {pkg !== undefined && (
        <p className="mono text-[13px] text-ink-3">
          <span aria-hidden className={`mr-1.5 inline-block size-1.5 rounded-full align-middle ${pkg.failed === 0 ? "bg-emerald" : "bg-critical"}`} />
          {pkg.passed}/{pkg.total} tests {pkg.failed === 0 ? "passing" : "passed"}
        </p>
      )}
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="mono text-[2rem] font-medium leading-none">{value}</p>
      <p className="mt-2 text-[13px] leading-snug text-ink-3">{label}</p>
    </div>
  );
}

const RULES: readonly { label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { label: "JSON check and format", Icon: FileJson },
  { label: "Test output summary", Icon: ListChecks },
  { label: "Lint check", Icon: SearchCode },
  { label: "File search", Icon: FileSearch },
];

function TiltFrame({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [4, -4]), { stiffness: 200, damping: 20 });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-5, 5]), { stiffness: 200, damping: 20 });
  return (
    <motion.div
      className="mt-6 overflow-hidden rounded-xl border border-white/10 will-change-transform"
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      onPointerMove={(event) => {
        if (reduce === true) return;
        const box = event.currentTarget.getBoundingClientRect();
        x.set((event.clientX - box.left) / box.width - 0.5);
        y.set((event.clientY - box.top) / box.height - 0.5);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

export function ArchitectureBento({ facts, onEngineering }: Props) {
  const date = facts.generatedAt.slice(0, 10);
  return (
    <section id="architecture" aria-labelledby="arch-title" className="mx-auto max-w-6xl px-6 py-24">
      <SectionHeader id="arch-title" title="Three packages, one direction">
        The dashboard depends on the router, and the router on the interceptor. Nothing points back, and tests enforce it.
      </SectionHeader>

      <div className="mt-12 grid grid-cols-12 gap-4">
        <Card hud className="col-span-12 lg:col-span-7">
          <PackageLabel path="packages/interceptor" name="@ai-finops/interceptor" facts={facts} />
          <h3 className="mt-6 text-2xl font-semibold tracking-tight">Prices every call exactly</h3>
          <p className="mt-3 max-w-xl text-pretty leading-relaxed text-ink-2">
            Parses Claude Code logs and API payloads. It collapses the repeated log lines, separates 5-minute from 1-hour cache writes, and attributes spend to each subagent.
          </p>
          <div className="mt-auto grid grid-cols-3 gap-4 pt-10">
            <Metric value={String(facts.models)} label="models priced" />
            <Metric value="4.2x" label="overcount removed in one real session" />
            <Metric value="4" label="subagents attributed" />
          </div>
        </Card>

        <Card hud className="col-span-12 md:col-span-6 lg:col-span-5">
          <PackageLabel path="packages/router" name="@ai-finops/router" facts={facts} />
          <h3 className="mt-6 text-2xl font-semibold tracking-tight">Answers the mechanical work first</h3>
          <p className="mt-3 text-pretty leading-relaxed text-ink-2">
            Each rule declines anything that needs judgement, so a script only answers when the answer is mechanical.
          </p>
          <ul className="mt-auto flex flex-wrap gap-2 pt-8">
            {RULES.map(({ label, Icon }) => (
              <li key={label} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm">
                <Icon aria-hidden className="size-4 text-emerald" />
                {label}
              </li>
            ))}
          </ul>
        </Card>

        <Card hud className="col-span-12 md:col-span-6 lg:col-span-5">
          <PackageLabel path="apps/dashboard" name="@ai-finops/dashboard" facts={facts} />
          <h3 className="mt-6 text-2xl font-semibold tracking-tight">Shows the bill as it happens</h3>
          <p className="mt-3 text-pretty leading-relaxed text-ink-2">Four KPI cards, a live spend chart, and a simulator that runs the real router and loop detector.</p>
          <TiltFrame>
            <div className="relative h-56 sm:h-64">
              <Image src="/dashboard.jpg" alt="The FinOps dashboard: four KPI cards above a chart of what the same work would have cost with and without optimisation." width={1200} height={1498} unoptimized className="absolute left-0 top-0 w-full" />
            </div>
          </TiltFrame>
        </Card>

        <Card className="col-span-12 lg:col-span-7">
          <p className="mono text-[13px] text-cyan">interceptor + dashboard</p>
          <h3 className="mt-6 text-2xl font-semibold tracking-tight">Catches a stuck agent</h3>
          <p className="mt-3 max-w-xl text-pretty leading-relaxed text-ink-2">
            Four identical requests in a row from one agent trips a circuit breaker. Further repeats are blocked before they reach a model.
          </p>
          <ol aria-label="Seven identical requests: four allowed, three blocked" className="mt-8 flex flex-wrap gap-2">
            {Array.from({ length: 7 }, (_, i) => {
              const blocked = i >= 4;
              return (
                <li key={i} className={`mono flex min-h-10 items-center rounded-lg border px-3 text-[13px] ${blocked ? "border-critical/40 bg-critical/10 text-critical line-through decoration-1" : "border-white/15 bg-white/[0.05] text-ink"}`}>
                  request {i + 1}
                  <span className="sr-only">{blocked ? ", blocked" : ", allowed"}</span>
                </li>
              );
            })}
          </ol>
          <ol aria-label="Dependency direction" className="mt-auto flex flex-wrap items-center gap-1.5 pt-8 text-[13px] text-ink-3">
            {["apps/dashboard", "packages/router", "packages/interceptor"].map((name, i, all) => (
              <li key={name} className="flex items-center gap-1.5">
                <span className="mono rounded-md bg-white/[0.06] px-2 py-1 text-ink-2">{name}</span>
                {i < all.length - 1 && (
                  <>
                    <ChevronRight aria-hidden className="size-4" />
                    <span className="sr-only">depends on</span>
                  </>
                )}
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Tests passing", value: `${facts.passed}/${facts.total}` },
          { label: "Test files", value: String(facts.files) },
          { label: "Offload rules", value: String(facts.rules) },
          { label: "Last recorded", value: date },
        ].map((v) => (
          <div key={v.label} className="glass rounded-2xl px-5 py-4">
            <dt className="text-[13px] text-ink-3">{v.label}</dt>
            <dd className="mono mt-1 text-xl">{v.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-10">
        <Button variant="glass" onClick={onEngineering}>
          Read the engineering deep-dive
        </Button>
      </div>
    </section>
  );
}
