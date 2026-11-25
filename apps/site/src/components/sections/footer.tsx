import { REPO_URL } from "../../lib/links";
import type { RepoFacts } from "../../lib/repo-facts";

export function Footer({ facts, onDeploy, onEngineering }: { facts: RepoFacts; onDeploy: () => void; onEngineering: () => void }) {
  const link = "inline-flex min-h-11 items-center rounded-md text-ink-2 transition-colors hover:text-ink";
  return (
    <footer className="mx-auto max-w-6xl border-t border-white/10 px-6 pb-[max(3rem,env(safe-area-inset-bottom))] pt-12">
      <div className="flex flex-wrap items-start justify-between gap-8">
        <p className="font-semibold tracking-tight">ai-finops-router</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 text-[15px]">
          <button type="button" className={link} onClick={onDeploy}>
            Deploy Router
          </button>
          <button type="button" className={link} onClick={onEngineering}>
            Engineering deep-dive
          </button>
          <a className={link} href={REPO_URL} target="_blank" rel="noopener noreferrer">
            Source on GitHub
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </nav>
      </div>
      <p className="mt-10 max-w-3xl text-[13px] leading-relaxed text-ink-3">
        The calculator is a model built on Anthropic list prices and the assumptions listed beneath it, not a quote. The log stream is a simulation parsed by the real interceptor and router. Test counts are read from this repository&apos;s <span className="mono">tests.json</span> when the page is built (last recorded {facts.generatedAt.slice(0, 10)}).
      </p>
    </footer>
  );
}
