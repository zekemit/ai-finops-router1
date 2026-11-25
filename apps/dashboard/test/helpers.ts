import { makeUsage } from "@ai-finops/interceptor";
import type { Milestone, TokenUsage } from "@ai-finops/interceptor";
import type { SubagentTask } from "@ai-finops/router";
import type { SimItem } from "../src/lib/sprint";

export const T0 = Date.parse("2026-11-03T09:00:00.000Z");

/** 1M output tokens on sonnet-5-5 = exactly $10: easy to reason about. */
export const TEN_DOLLARS: TokenUsage = makeUsage({ outputTokens: 1_000_000 });

export function llmItem(o: {
  id: string;
  atMs: number;
  prompt?: string;
  agent?: SubagentTask["agent"];
  session?: string;
  usage?: TokenUsage;
  featureId?: string;
  milestone?: Milestone;
  latencyMs?: number;
}): SimItem {
  return {
    atMs: o.atMs,
    sessionId: o.session ?? "sprint-9",
    intent: "llm",
    task: {
      id: o.id,
      timestamp: new Date(o.atMs).toISOString(),
      agent: o.agent ?? "Security_Agent",
      model: "claude-sonnet-5-5",
      prompt: o.prompt ?? `Design thing ${o.id}`,
    },
    llm: {
      usage: o.usage ?? TEN_DOLLARS,
      latencyMs: o.latencyMs ?? 1_000,
      featureId: o.featureId ?? "F-test",
      ...(o.milestone === undefined ? {} : { milestone: o.milestone }),
    },
  };
}

export function scriptItem(o: { id: string; atMs: number; contextTokens?: number }): SimItem {
  return {
    atMs: o.atMs,
    sessionId: "sprint-9",
    intent: "script",
    task: {
      id: o.id,
      timestamp: new Date(o.atMs).toISOString(),
      agent: "PM_Agent",
      model: "claude-sonnet-5-5",
      prompt: "Format this JSON",
      inputs: { text: '{"b":1}' },
      ...(o.contextTokens === undefined ? {} : { contextTokens: o.contextTokens }),
    },
    llm: { usage: makeUsage({ outputTokens: 100 }), latencyMs: 500, featureId: "F-test" },
  };
}
