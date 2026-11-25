import { formatInt, formatMs, formatPct } from "@ai-finops/interceptor";
import { AGENT_COLOR, AGENT_NAME, headlineUsd } from "../lib/labels";
import type { Kpis } from "../lib/view-model";

const TH = "px-2 py-2 text-right text-[13px] font-medium text-ink-2";
const TD = "num px-2 py-2.5 text-right text-sm";

export function AgentTable({ kpis }: { kpis: Kpis }) {
  const total = kpis.summary.totalCostUsd;
  return (
    <section aria-label="Spend by agent" className="min-w-0">
      <h2 className="text-lg font-semibold tracking-tight">Spend by agent</h2>
      <p className="mt-0.5 text-sm text-ink-2">Cache hit is the share of each agent&apos;s prompt tokens read from the prompt cache.</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse">
          <thead>
            <tr className="border-b border-rule">
              <th scope="col" className="px-2 py-2 text-left text-[13px] font-medium text-ink-2">
                Agent
              </th>
              <th scope="col" className={TH}>Calls</th>
              <th scope="col" className={TH}>Spend</th>
              <th scope="col" className={`${TH} w-28`}>Share</th>
              <th scope="col" className={TH}>Cache hit</th>
              <th scope="col" className={TH}>Avg latency</th>
              <th scope="col" className={TH}>p95</th>
            </tr>
          </thead>
          <tbody>
            {kpis.summary.byAgent.map((a) => (
              <tr key={a.agent} className="border-b border-rule last:border-b-0">
                <th scope="row" className="px-2 py-2.5 text-left text-sm font-medium">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="block size-2.5 rounded-[3px]" style={{ background: AGENT_COLOR[a.agent] }} />
                    {AGENT_NAME[a.agent]}
                  </span>
                </th>
                <td className={TD}>{formatInt(a.calls)}</td>
                <td className={TD}>{headlineUsd(a.costUsd)}</td>
                <td className="px-2 py-2.5">
                  <span aria-hidden className="ml-auto block h-2 w-24 rounded-[3px] bg-rule/70">
                    <span className="block h-full rounded-[3px]" style={{ width: `${total > 0 ? (a.costUsd / total) * 100 : 0}%`, background: AGENT_COLOR[a.agent] }} />
                  </span>
                  <span className="sr-only">{formatPct(total > 0 ? a.costUsd / total : 0)} of spend</span>
                </td>
                <td className={TD}>{a.calls > 0 ? formatPct(a.cacheHitRate) : "–"}</td>
                <td className={TD}>{formatMs(a.avgLatencyMs)}</td>
                <td className={TD}>{formatMs(a.p95LatencyMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
