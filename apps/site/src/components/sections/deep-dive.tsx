"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { CodeBlock } from "../ui/code-block";
import { RangeField } from "../ui/range-field";
import { Tabs } from "../ui/tabs";
import { usd } from "../../lib/format";
import { overcount } from "../../lib/sample";

function Prose({ children }: { children: ReactNode }) {
  return <div className="space-y-4 text-pretty text-[15px] leading-relaxed text-ink-2">{children}</div>;
}

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="mb-3 mt-8 text-lg font-semibold tracking-tight first:mt-0">{children}</h3>;
}

function OvercountDemo() {
  const [blocks, setBlocks] = useState(3);
  const o = overcount(blocks);
  return (
    <div className="glass rounded-2xl p-5">
      <RangeField id="blocks" label="Content blocks in one call" min={1} max={6} step={1} value={blocks} display={String(blocks)} onChange={setBlocks} />
      <div className="mt-5 space-y-4">
        {[
          { label: "Summing every line says", value: o.summedUsd, color: "#eb6263", icon: <TriangleAlert aria-hidden className="size-4 text-critical" /> },
          { label: "The call actually cost", value: o.correctUsd, color: "#e6edf3", icon: <Check aria-hidden className="size-4" /> },
        ].map((bar) => (
          <div key={bar.label}>
            <div className="flex items-baseline justify-between gap-3 text-[15px]">
              <span className="flex items-center gap-2 text-ink-2">
                {bar.icon}
                {bar.label}
              </span>
              <span className="mono text-ink">{usd(bar.value)}</span>
            </div>
            <span aria-hidden className="mt-2 block h-2.5 overflow-hidden rounded-[4px] bg-white/[0.07]">
              <span className="block h-full rounded-[4px] transition-[width] duration-500 ease-[var(--spring)]" style={{ width: `${(bar.value / (o.summedUsd || 1)) * 100}%`, background: bar.color }} />
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[15px]">
        Overstated by <span className="mono text-critical">{o.factor}x</span>. The call is a Sonnet 5.5 turn with 61,517 cached tokens read and 55,115 written to the 1-hour cache.
      </p>
    </div>
  );
}

function Overcounting() {
  return (
    <Prose>
      <p>
        Claude Code writes one log line per content block, a thinking block, a text block, each tool call, and repeats the call&apos;s full token usage on every line. Add the lines up and every call is billed once per block.
      </p>
      <OvercountDemo />
      <Heading>What it did to a real session</Heading>
      <p>
        On one real session the log held 305 records that parsed into 34 billed calls. Summing every line said <span className="mono text-critical">$13.61</span>. The correct total was <span className="mono text-ink">$3.21</span>, and an independent recomputation with no interceptor code agreed to the cent.
      </p>
      <Heading>The fix</Heading>
      <p>A call is identified by its message id and request id. Lines that share both are one call, and the parser keeps the line with the largest output token count, because streamed duplicates can carry partial counts.</p>
      <CodeBlock
        title="packages/interceptor/src/jsonl-parser.ts"
        code={`function callKey(record, message, lineNo): string {
  const messageId = asString(message["id"]);
  const requestId = asString(record["requestId"]);
  if (messageId !== undefined && requestId !== undefined) return \`\${messageId}|\${requestId}\`;
  return asString(record["uuid"]) ?? \`line-\${lineNo}\`;
}`}
      />
      <Heading>Two more pricing details it got wrong first</Heading>
      <ul className="list-disc space-y-2 pl-5">
        <li>Cache writes have two tiers: 5-minute writes cost 1.25x the input price and 1-hour writes 2x. Real logs carry the split, and a flat multiplier misprices them.</li>
        <li>Cache reads are priced per model, from 0.025x to 0.1x of the input price, not a flat 10%.</li>
      </ul>
    </Prose>
  );
}

function Determinism() {
  return (
    <Prose>
      <p>
        The dashboard rendered <span className="mono text-ink">$6.77</span> on the server and <span className="mono text-ink">$6.88</span> in the browser for the same seed, and React reported a hydration mismatch.
      </p>
      <Heading>The cause was one line</Heading>
      <CodeBlock
        diff
        title="apps/dashboard/src/lib/sample-data.ts"
        code={`- const criteria = [...CRITERIA].sort(() => rng.next() - 0.5).slice(0, rng.int(2, 4));
+ const criteria = rng.shuffle(CRITERIA).slice(0, rng.int(2, 4));`}
      />
      <p>
        A sort comparator that draws from the random stream makes the order of draws depend on how each engine&apos;s sort calls it. Node and Chromium disagree, so every later number in the simulation differed. The generator was seeded, but not portable.
      </p>
      <Heading>Why the tests missed it</Heading>
      <p>Every test ran in a single engine. Only loading the built page in a real browser and comparing it with the server&apos;s HTML exposed the difference.</p>
      <Heading>The shuffle and its guard</Heading>
      <CodeBlock
        title="apps/dashboard/src/lib/rng.ts"
        code={`shuffle: (items) => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = int(0, i); // Fisher-Yates on the seeded stream
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}`}
      />
      <CodeBlock
        title="apps/dashboard/test/determinism.test.ts"
        code={`expect(read(file)).not.toMatch(/\\.sort\\(\\s*\\(\\s*\\)\\s*=>/);
expect(read(file)).not.toMatch(/Math\\.random|Date\\.now|new Date\\(\\)|performance\\.now/);`}
      />
      <p>This site&apos;s calculator and log stream are held to the same rule by a test of their own, because they also render on the server and again in the browser.</p>
    </Prose>
  );
}

function Orchestration() {
  return (
    <Prose>
      <Heading>Which subagent a call belongs to</Heading>
      <ol className="list-decimal space-y-2 pl-5">
        <li>An explicit tag on the line: <span className="mono text-ink">agent</span>, <span className="mono text-ink">agentName</span> or <span className="mono text-ink">subagent_type</span>, normalised to PM, Architect, Security or Release.</li>
        <li>Otherwise the Task call that spawned it, but only for sidechain lines. The main thread resuming after a Task result is never charged to the subagent.</li>
        <li>Otherwise the call is unattributed. A name that matches none of the four is never guessed.</li>
      </ol>
      <p className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        Honest limit: the Task-call path is covered by fixtures built from the documented fields. The only real log available had no subagent lines, so it has not been checked against real subagent logs.
      </p>
      <Heading>Runaway loops</Heading>
      <p>
        Four identical consecutive calls from one agent, in one session, with gaps of at most 120 seconds, raise an alert and engage a circuit breaker that blocks further repeats. A different call in between counts as progress and ends the run, so edit-and-test cycles are never flagged.
      </p>
      <Heading>What the router will and will not answer</Heading>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] border-collapse text-left text-[14px]">
          <thead>
            <tr className="border-b border-white/10 text-ink-3">
              <th scope="col" className="py-2 pr-4 font-medium">Rule</th>
              <th scope="col" className="py-2 pr-4 font-medium">Answers</th>
              <th scope="col" className="py-2 font-medium">Declines</th>
            </tr>
          </thead>
          <tbody className="align-top">
            {[
              ["json-format", "Validate, format, minify, sort keys, check a schema", "Fix or explain requests; schemas with $ref, if or format"],
              ["test-summary", "Counts and failures from vitest, jest, pytest, go test", "Why a test failed; unrecognised runners"],
              ["lint-check", "Whitespace, indentation, line length, debugger, conflict markers", "Fix the lint errors"],
              ["grep-search", "Literal or regex search with grep-style output", "Explain-and-search; regexes that can backtrack badly"],
            ].map(([rule, answers, declines]) => (
              <tr key={rule} className="border-b border-white/[0.07] last:border-b-0">
                <th scope="row" className="mono py-3 pr-4 font-normal text-ink">{rule}</th>
                <td className="py-3 pr-4">{answers}</td>
                <td className="py-3">{declines}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Verbs that mean judgement, such as fix, explain, why and review, send a task to the model. If a script throws, the router skips it and the model handles the task, so a faulty rule cannot fail an agent.
      </p>
    </Prose>
  );
}

export function DeepDive() {
  return (
    <Tabs
      label="Engineering topics"
      tabs={[
        { id: "overcount", label: "The 4x overcount", content: <Overcounting /> },
        { id: "determinism", label: "Determinism", content: <Determinism /> },
        { id: "orchestration", label: "Orchestration rules", content: <Orchestration /> },
      ]}
    />
  );
}
