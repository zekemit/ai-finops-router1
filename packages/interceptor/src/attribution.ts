import type { AgentName } from "./types";

/** Lower-cased, separator-free spellings accepted for each agent. */
const ALIASES: Readonly<Record<string, AgentName>> = {
  pmagent: "PM_Agent",
  pm: "PM_Agent",
  architectagent: "Architect_Agent",
  architect: "Architect_Agent",
  securityagent: "Security_Agent",
  security: "Security_Agent",
  releaseagent: "Release_Agent",
  release: "Release_Agent",
};

/**
 * Map a free-form agent label (`pm-agent`, `SECURITY_AGENT`, `architect`) to a canonical
 * `AgentName`. Returns `undefined` for anything else: unknown agents must never be silently re-labelled.
 */
export function normalizeAgentName(raw: unknown): AgentName | undefined {
  if (typeof raw !== "string") return undefined;
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  return Object.hasOwn(ALIASES, key) ? ALIASES[key] : undefined;
}
