import type { AgentLabel } from "@ai-finops/interceptor";
import type { RuleId } from "@ai-finops/router";

export const AGENT_NAME: Readonly<Record<AgentLabel, string>> = {
  PM_Agent: "PM agent",
  Architect_Agent: "Architect agent",
  Security_Agent: "Security agent",
  Release_Agent: "Release agent",
  Unattributed: "Orchestrator",
};

/** CSS custom properties (see globals.css), so one place swaps light and dark. */
export const AGENT_COLOR: Readonly<Record<AgentLabel, string>> = {
  PM_Agent: "var(--agent-pm)",
  Architect_Agent: "var(--agent-arch)",
  Security_Agent: "var(--agent-sec)",
  Release_Agent: "var(--agent-rel)",
  Unattributed: "var(--agent-other)",
};

export const RULE_NAME: Readonly<Record<RuleId, string>> = {
  "json-format": "JSON check and format",
  "test-summary": "Test output summary",
  "lint-check": "Lint check",
  "grep-search": "File search",
};

/** `claude-opus-5-5` -> `Opus 5.5`. Unknown ids pass through untouched. */
export function modelLabel(model: string): string {
  const match = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model);
  if (match?.[1] === undefined) return model;
  return `${match[1].charAt(0).toUpperCase()}${match[1].slice(1)} ${match[2]}.${match[3]}`;
}

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Headline dollars: two decimals, e.g. `$6.79`. Per-call amounts use the interceptor's `formatUsd` (4 decimals under $1). */
export const headlineUsd = (value: number): string => dollars.format(value);

/** `09:30` in UTC, so server and client render identically. */
export const clockLabel = (ms: number): string => new Date(ms).toISOString().slice(11, 16);
