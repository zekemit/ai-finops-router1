import { formatPct } from "@ai-finops/interceptor";
import { headlineUsd } from "../lib/labels";
import type { SprintRow } from "../lib/view-model";

/** The chart's data as a table: the accessible view, and the place to read exact figures. */
export function SprintTable({ rows }: { rows: readonly SprintRow[] }) {
  return (
    <details className="group rounded-xl border border-rule bg-surface px-5 py-3">
      <summary className="cursor-pointer text-sm font-medium">View the chart as a table</summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[30rem] border-collapse">
          <thead>
            <tr className="border-b border-rule text-[13px] font-medium text-ink-2">
              <th scope="col" className="px-2 py-2 text-left">Sprint</th>
              <th scope="col" className="px-2 py-2 text-right">Features shipped</th>
              <th scope="col" className="px-2 py-2 text-right">Paid</th>
              <th scope="col" className="px-2 py-2 text-right">Without caching and scripts</th>
              <th scope="col" className="px-2 py-2 text-right">Saved</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.sessionId} className="num border-b border-rule text-sm last:border-b-0">
                <th scope="row" className="px-2 py-2 text-left font-medium">{row.label}</th>
                <td className="px-2 py-2 text-right">{row.features}</td>
                <td className="px-2 py-2 text-right">{headlineUsd(row.spendUsd)}</td>
                <td className="px-2 py-2 text-right">{headlineUsd(row.withoutOptimizationUsd)}</td>
                <td className="px-2 py-2 text-right text-saved">
                  {headlineUsd(row.savedUsd)} ({formatPct(row.savedPct)})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
