import { GitBranch } from "lucide-react";
import type { ReactNode } from "react";
import { LinkButton } from "../ui/button";
import { CodeBlock } from "../ui/code-block";
import { CLONE_URL, REPO_URL } from "../../lib/links";

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span aria-hidden className="mono flex size-7 shrink-0 items-center justify-center rounded-full border border-white/15 text-[13px] text-ink-2">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-3 pb-2">
        <h3 className="pt-0.5 font-semibold tracking-tight">{title}</h3>
        {children}
      </div>
    </li>
  );
}

export function DeployContent() {
  return (
    <div className="space-y-8">
      <p className="text-pretty text-[15px] leading-relaxed text-ink-2">
        ai-finops-router runs on your machine against your own logs. It needs Node 22.12 or newer.
      </p>
      <ol className="space-y-6">
        <Step n={1} title="Get the code">
          <CodeBlock title="Terminal" code={`git clone ${CLONE_URL}\ncd ai-finops-router1`} />
        </Step>
        <Step n={2} title="Install, test and start the dashboard">
          <CodeBlock title="Terminal" code="./init.sh" />
          <p className="text-[14px] text-ink-3">Installs dependencies, runs every test, typechecks, then serves the dashboard at http://localhost:3000.</p>
        </Step>
        <Step n={3} title="Price your own sessions">
          <CodeBlock title="Terminal" code="npm run finops -- ~/.claude/projects" />
          <p className="text-[14px] text-ink-3">Reads every session log under that folder and prints spend, cache hit rate and latency per agent.</p>
        </Step>
        <Step n={4} title="Put the router in front of a model call">
          <CodeBlock
            title="TypeScript"
            code={`import { createRouter } from "@ai-finops/router";

const router = createRouter({ onOffload: (record) => console.log(JSON.stringify(record)) });
const result = await router.handle(task, (t) => callYourModel(t));`}
          />
          <p className="text-[14px] text-ink-3">The model call runs only when no script can answer. Each scripted answer logs its dollars and tokens saved.</p>
        </Step>
      </ol>
      <LinkButton href={REPO_URL} variant="primary" target="_blank" rel="noopener noreferrer">
        <GitBranch aria-hidden className="size-[18px]" />
        View source on GitHub
        <span className="sr-only"> (opens in a new tab)</span>
      </LinkButton>
    </div>
  );
}
