import type { Summary } from "./aggregate";
import { formatInt, formatMs, formatPct, formatUsd } from "./format";

const HEADER = ["Agent", "Calls", "Spend", "Cache hit", "Cache savings", "Avg latency", "p95"] as const;

function plural(count: number, noun: string): string {
  return `${formatInt(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** Plain-text FinOps report: per-agent table, totals, and every caveat that affects how far to trust the numbers. */
export function formatSummaryReport(summary: Summary): string {
  const rows: string[][] = [
    ...summary.byAgent.map((a) => [
      a.agent,
      formatInt(a.calls),
      formatUsd(a.costUsd),
      formatPct(a.cacheHitRate),
      formatUsd(a.cacheSavingsUsd),
      formatMs(a.avgLatencyMs),
      formatMs(a.p95LatencyMs),
    ]),
    [
      "TOTAL",
      formatInt(summary.calls),
      formatUsd(summary.totalCostUsd),
      formatPct(summary.cacheHitRate),
      formatUsd(summary.cacheSavingsUsd),
      formatMs(summary.avgLatencyMs),
      formatMs(summary.p95LatencyMs),
    ],
  ];

  const widths = HEADER.map((title, col) => Math.max(title.length, ...rows.map((row) => row[col]?.length ?? 0)));
  const render = (cells: readonly string[]): string =>
    cells.map((cell, col) => (col === 0 ? cell.padEnd(widths[col] ?? 0) : cell.padStart(widths[col] ?? 0))).join("  ");

  const lines: string[] = [render(HEADER), "-".repeat(widths.reduce((sum, w) => sum + w, 0) + 2 * (HEADER.length - 1))];
  rows.forEach((row, i) => {
    if (i === rows.length - 1) lines.push(lines[1] ?? "");
    lines.push(render(row));
  });

  lines.push("");
  lines.push(`Cache savings: ${formatUsd(summary.cacheSavingsUsd)} (${formatPct(summary.cacheSavingsPct)}) vs. the same traffic with no prompt caching`);
  if (summary.costPerFeatureUsd !== null) {
    lines.push(`Cost per feature shipped: ${formatUsd(summary.costPerFeatureUsd)} (${plural(summary.featuresShipped, "feature")})`);
  }
  if (summary.unpriced.length > 0) {
    const list = summary.unpriced.map((u) => `${u.model} (${plural(u.calls, "call")})`).join(", ");
    lines.push(`Unpriced models (excluded from $): ${list}`);
  }
  if (summary.assumedPricingModels.length > 0) {
    lines.push(`Assumed cache-read pricing: ${summary.assumedPricingModels.join(", ")}`);
  }
  return lines.join("\n");
}
