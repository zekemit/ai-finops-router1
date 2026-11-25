import { GitBranch, Rocket } from "lucide-react";
import { Button, LinkButton } from "../ui/button";
import { REPO_URL } from "../../lib/links";

interface Props {
  readonly onDeploy: () => void;
  readonly onEngineering: () => void;
}

const LINK = "rounded-full px-3.5 py-2 text-sm text-ink-2 transition-colors hover:text-ink";

export function Nav({ onDeploy, onEngineering }: Props) {
  return (
    <header className="sticky top-0 z-40 pt-[env(safe-area-inset-top)]">
      <div className="glass mx-auto mt-3 flex max-w-6xl items-center justify-between gap-4 rounded-full py-2 pl-5 pr-2 max-md:mx-3">
        <a href="#top" className="-ml-1 flex min-h-10 items-center gap-2.5 px-1 font-semibold tracking-tight" aria-label="ai-finops-router, back to top">
          <svg aria-hidden viewBox="0 0 32 32" className="size-6">
            <path d="M8 22V10m0 0 8 6-8 6m8-12v12m8-12v12" fill="none" stroke="#06b6d4" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="24" cy="10" r="2.4" fill="#34d399" />
          </svg>
          <span className="max-sm:hidden">ai-finops-router</span>
        </a>
        <nav aria-label="Sections" className="flex items-center gap-0.5 max-md:hidden">
          <a href="#roi" className={LINK}>
            Calculator
          </a>
          <a href="#architecture" className={LINK}>
            Architecture
          </a>
          <a href="#stream" className={LINK}>
            Log stream
          </a>
          <button type="button" onClick={onEngineering} className={LINK}>
            Engineering
          </button>
        </nav>
        <div className="flex items-center gap-1.5">
          <LinkButton href={REPO_URL} variant="ghost" size="sm" target="_blank" rel="noopener noreferrer" aria-label="Source code on GitHub (opens in a new tab)">
            <GitBranch aria-hidden className="size-4" />
            <span className="max-sm:hidden">Source</span>
          </LinkButton>
          <Button variant="primary" size="sm" onClick={onDeploy}>
            <Rocket aria-hidden className="size-4" />
            Deploy Router
          </Button>
        </div>
      </div>
    </header>
  );
}
