"use client";

import { MotionConfig } from "motion/react";
import { useMemo, useState } from "react";
import { ArchitectureBento } from "./sections/architecture-bento";
import { DeepDive } from "./sections/deep-dive";
import { DeployContent } from "./sections/deploy";
import { Footer } from "./sections/footer";
import { Hero } from "./sections/hero";
import { LogStream } from "./sections/log-stream";
import { Nav } from "./sections/nav";
import { RoiCalculator } from "./sections/roi-calculator";
import { Drawer } from "./ui/drawer";
import { ErrorBoundary } from "./ui/error-boundary";
import { DEFAULT_ROI_INPUTS, computeRoi } from "../lib/roi";
import type { RepoFacts } from "../lib/repo-facts";

type DrawerName = "deploy" | "engineering" | null;

export function SiteShell({ facts }: { facts: RepoFacts }) {
  const [inputs, setInputs] = useState(DEFAULT_ROI_INPUTS);
  const result = useMemo(() => computeRoi(inputs), [inputs]);
  const [drawer, setDrawer] = useState<DrawerName>(null);
  const open = (name: Exclude<DrawerName, null>) => () => setDrawer(name);
  const close = (): void => setDrawer(null);

  return (
    <MotionConfig reducedMotion="user">
      {/* The page behind an open drawer is inert: unfocusable and hidden from assistive tech. */}
      <div inert={drawer !== null}>
        <a href="#roi" className="sr-only z-50 rounded-full bg-white px-4 py-2 font-medium text-canvas focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          Skip to the calculator
        </a>
        <Nav onDeploy={open("deploy")} onEngineering={open("engineering")} />
        <main>
          <ErrorBoundary label="The hero">
            <Hero facts={facts} result={result} onDeploy={open("deploy")} />
          </ErrorBoundary>
          <ErrorBoundary label="The calculator">
            <RoiCalculator inputs={inputs} result={result} onChange={setInputs} />
          </ErrorBoundary>
          <ErrorBoundary label="The architecture overview">
            <ArchitectureBento facts={facts} onEngineering={open("engineering")} />
          </ErrorBoundary>
          <ErrorBoundary label="The log stream">
            <LogStream />
          </ErrorBoundary>
        </main>
        <Footer facts={facts} onDeploy={open("deploy")} onEngineering={open("engineering")} />
      </div>

      <Drawer open={drawer === "deploy"} onClose={close} title="Deploy Router" description="Self-hosted. It reads your logs on your machine.">
        <ErrorBoundary label="The deploy guide">
          <DeployContent />
        </ErrorBoundary>
      </Drawer>
      <Drawer open={drawer === "engineering"} onClose={close} title="Engineering deep-dive" description="Three problems that were found by running the system, and how each was fixed.">
        <ErrorBoundary label="The deep-dive">
          <DeepDive />
        </ErrorBoundary>
      </Drawer>
    </MotionConfig>
  );
}
