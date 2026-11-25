import { formatInt, formatPct } from "@ai-finops/interceptor";
import { FileJson, FileSearch, ListChecks, SearchCode } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import type { RuleId } from "@ai-finops/router";
import { RULE_NAME, headlineUsd } from "../lib/labels";
import type { Kpis } from "../lib/view-model";

const ICON: Readonly<Record<RuleId, ComponentType<SVGProps<SVGSVGElement>>>> = {
  "json-format": FileJson,
  "test-summary": ListChecks,
  "lint-check": SearchCode,
  "grep-search": FileSearch,
};

const TH = "px-2 py-2 text-right text-[13px] font-medium text-ink-2";
const TD = "num px-2 py-2.5 text-right text-sm";

export function OffloadPanel({ kpis, interceptedCalls }: { kpis: Kpis; interceptedCalls: number }) {
  const { offloads } = kpis;
  return (
    <section aria-label="Tasks answered by scripts" className="min-w-0">
      <h2 className="text-lg font-semibold tracking-tight">Tasks answered by scripts</h2>
      <p className="mt-0.5 text-sm text-ink-2">
        {offloads.offloadedCalls === 0
          ? "No task has been mechanical enough to skip the model yet."
          : `${formatInt(offloads.offloadedCalls)} of ${formatInt(interceptedCalls)} tasks (${formatPct(offloads.offloadRate ?? 0)}) never reached a model.`}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[26rem] border-collapse">
          <thead>
            <tr className="border-b border-rule">
              <th scope="col" className="px-2 py-2 text-left text-[13px] font-medium text-ink-2">Script</th>
              <th scope="col" className={TH}>Tasks</th>
              <th scope="col" className={TH}>Tokens avoided</th>
              <th scope="col" className={TH}>Saved</th>
            </tr>
          </thead>
          <tbody>
            {offloads.byRule.map((rule) => {
              const Icon = ICON[rule.ruleId];
              return (
                <tr key={rule.ruleId} className="border-b border-rule last:border-b-0">
                  <th scope="row" className="px-2 py-2.5 text-left text-sm font-medium">
                    <span className="flex items-center gap-2">
                      <Icon aria-hidden className="size-4 text-ink-2" />
                      {RULE_NAME[rule.ruleId]}
                    </span>
                  </th>
                  <td className={TD}>{formatInt(rule.calls)}</td>
                  <td className={TD}>{formatInt(kpis.offloadTokensByRule[rule.ruleId])}</td>
                  <td className={`${TD} text-saved`}>{headlineUsd(rule.savedUsd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[13px] text-ink-2">
        Dollars price the model call each task replaced, including the cached context it would have re-read, at that agent&apos;s model rates. Tokens avoided count only the prompt, attached data and answer, and are estimates because the call never happened.
        {offloads.unpricedCalls > 0 && ` ${offloads.unpricedCalls} tasks used a model with no price on file and count as $0.`}
      </p>
    </section>
  );
}
