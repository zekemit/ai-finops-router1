/** Presentation helpers. Money is rounded here and nowhere else. Fixed `en-US` so output is deterministic. */

const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd4 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** `$1,234.57`; amounts under $1 keep up to 4 decimals (`$0.2346`) because per-call costs are tiny. */
export function formatUsd(value: number): string {
  const formatter = Math.abs(value) < 1 ? usd4 : usd2;
  const text = formatter.format(value);
  return /^-\$0\.0+$/.test(text) ? text.slice(1) : text; // never "-$0.00"
}

/** A ratio in [0,1] as a percentage with one decimal. */
export function formatPct(ratio: number): string {
  const text = `${(ratio * 100).toFixed(1)}%`;
  return text === "-0.0%" ? "0.0%" : text;
}

export function formatInt(value: number): string {
  return int.format(value);
}

/** `450ms`, `1.2s`, or an em dash when unknown. */
export function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
