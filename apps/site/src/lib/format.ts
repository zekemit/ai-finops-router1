/** Fixed en-US so the server render and the browser render are byte-identical. */

const whole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fine = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 });
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** `$12,345` for large sums, `$12.34` below $100, so small figures keep their cents. */
export function usd(value: number): string {
  const rounded = Math.abs(value) < 100 ? cents.format(value) : whole.format(value);
  return rounded.replace(/^-\$0\.00$/, "$0.00");
}

/** Four decimals, for per-call amounts. */
export const usdFine = (value: number): string => fine.format(value);

export const int = (value: number): string => integer.format(Math.round(value));

export const pct = (ratio: number, digits = 1): string => {
  const text = `${(ratio * 100).toFixed(digits)}%`;
  return text === "-0.0%" ? "0.0%" : text;
};

/** `4.5x`. */
export const times = (value: number): string => `${value.toFixed(value >= 10 ? 0 : 1)}x`;

/** 1_250_000 -> `1.25M`, 42_000 -> `42.0K`. */
export function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value));
}

/** `09:00:07` in UTC. */
export const clock = (ms: number): string => new Date(ms).toISOString().slice(11, 19);
