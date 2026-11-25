/** Test-only builders for Claude Code JSONL records. Shapes mirror real session logs. */

import type { AgentLabel, Milestone, TelemetryEvent, TokenUsage } from "../src/types";
import { makeUsage } from "../src/usage";

export type Rec = Record<string, unknown>;

export const DEFAULT_API_USAGE: Rec = {
  input_tokens: 10,
  output_tokens: 20,
  cache_read_input_tokens: 100,
  cache_creation_input_tokens: 0,
};

export function assistantRecord(o: {
  uuid: string;
  messageId: string;
  requestId: string;
  timestamp: string;
  parentUuid?: string | null;
  model?: string;
  sessionId?: string;
  isSidechain?: boolean;
  usage?: Rec;
  content?: readonly Rec[];
  extra?: Rec;
}): Rec {
  return {
    parentUuid: o.parentUuid ?? null,
    isSidechain: o.isSidechain ?? false,
    type: "assistant",
    uuid: o.uuid,
    timestamp: o.timestamp,
    sessionId: o.sessionId ?? "sess-1",
    requestId: o.requestId,
    message: {
      id: o.messageId,
      type: "message",
      role: "assistant",
      model: o.model ?? "claude-sonnet-5-5",
      content: o.content ?? [{ type: "text", text: "ok" }],
      usage: o.usage ?? DEFAULT_API_USAGE,
    },
    ...(o.extra ?? {}),
  };
}

export function userRecord(o: {
  uuid: string;
  timestamp: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  sessionId?: string;
  content?: readonly Rec[] | string;
}): Rec {
  return {
    parentUuid: o.parentUuid ?? null,
    isSidechain: o.isSidechain ?? false,
    type: "user",
    uuid: o.uuid,
    timestamp: o.timestamp,
    sessionId: o.sessionId ?? "sess-1",
    message: { role: "user", content: o.content ?? "hello" },
  };
}

export function toolUse(id: string, name: string, input: Rec): Rec {
  return { type: "tool_use", id, name, input };
}

export function toJsonl(records: readonly Rec[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

let eventCounter = 0;

/** Build a `TelemetryEvent` with sensible defaults; ids are unique and deterministic per test run. */
export function makeEvent(
  o: {
    id?: string;
    timestamp?: string;
    sessionId?: string;
    agent?: AgentLabel;
    model?: string;
    usage?: Partial<TokenUsage>;
    latencyMs?: number | null;
    featureId?: string;
    milestone?: Milestone;
    fingerprint?: string;
  } = {},
): TelemetryEvent {
  eventCounter += 1;
  return {
    id: o.id ?? `ev-${eventCounter}`,
    timestamp: o.timestamp ?? "2026-11-25T10:00:00.000Z",
    sessionId: o.sessionId ?? "sess-1",
    agent: o.agent ?? "PM_Agent",
    model: o.model ?? "claude-sonnet-5-5",
    usage: makeUsage(o.usage ?? {}),
    latencyMs: o.latencyMs === undefined ? null : o.latencyMs,
    source: "api-payload",
    ...(o.featureId === undefined ? {} : { featureId: o.featureId }),
    ...(o.milestone === undefined ? {} : { milestone: o.milestone }),
    ...(o.fingerprint === undefined ? {} : { fingerprint: o.fingerprint }),
  };
}
