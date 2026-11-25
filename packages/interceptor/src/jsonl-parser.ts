import { parseApiUsage } from "./anthropic-usage";
import { normalizeAgentName } from "./attribution";
import { asString, isRecord } from "./guards";
import type { UnknownRecord } from "./guards";
import { fnv1a, stableStringify } from "./hash";
import { makeStats, parseTimestamp, sortEvents } from "./parse-common";
import { UNATTRIBUTED } from "./types";
import type { AgentName, ParseResult, ParseWarning, TelemetryEvent, TokenUsage } from "./types";

export interface ParseJsonlOptions {
  /** Used for lines that carry no `sessionId` (e.g. derive it from the file name). */
  readonly sessionId?: string;
}

interface Candidate {
  readonly lineNo: number;
  readonly record: UnknownRecord;
  readonly ms: number;
  readonly usage: TokenUsage;
  readonly model: string;
}

interface AttributionContext {
  readonly byUuid: ReadonlyMap<string, UnknownRecord>;
  /** assistant-line uuid -> subagent named by a Task tool call in that message. */
  readonly spawners: ReadonlyMap<string, AgentName>;
  /** uuid -> resolved agent (null = resolved to none). Resolution depends only on the record. */
  readonly cache: Map<string, AgentName | null>;
}

const TASK_TOOL_NAMES: ReadonlySet<string> = new Set(["Task", "Agent"]);
const AGENT_TAG_KEYS = ["agent", "agentName", "agent_name", "subagentType", "subagent_type"] as const;
const SYNTHETIC_MODEL = "<synthetic>";

function contentBlocks(record: UnknownRecord): UnknownRecord[] {
  const message = record["message"];
  if (!isRecord(message)) return [];
  const content: unknown = message["content"];
  if (!Array.isArray(content)) return [];
  return (content as unknown[]).filter(isRecord);
}

function toolUses(record: UnknownRecord): UnknownRecord[] {
  return contentBlocks(record).filter((block) => block["type"] === "tool_use");
}

/** The subagent a Task/Agent tool call in this assistant line launches, if it is one of ours. */
function spawnedAgent(record: UnknownRecord): AgentName | undefined {
  for (const block of toolUses(record)) {
    const name = asString(block["name"]);
    const input = block["input"];
    if (name === undefined || !TASK_TOOL_NAMES.has(name) || !isRecord(input)) continue;
    const agent = normalizeAgentName(input["subagent_type"]);
    if (agent !== undefined) return agent;
  }
  return undefined;
}

function explicitAgent(record: UnknownRecord): AgentName | undefined {
  for (const key of AGENT_TAG_KEYS) {
    const agent = normalizeAgentName(record[key]);
    if (agent !== undefined) return agent;
  }
  return undefined;
}

/**
 * Walk up the parentUuid chain. A record resolves to:
 *   1. its own explicit agent tag, else
 *   2. the subagent named by the Task call that spawned it (only if the record is a sidechain
 *      line, so the main thread resuming after a Task result is NOT charged to the subagent), else
 *   3. whatever its parent resolves to.
 */
function resolveAgent(start: UnknownRecord, ctx: AttributionContext): AgentName | undefined {
  const path: string[] = [];
  const seen = new Set<string>();
  let result: AgentName | undefined;
  let current: UnknownRecord | undefined = start;

  while (current !== undefined) {
    const uuid = asString(current["uuid"]);
    if (uuid !== undefined) {
      const cached = ctx.cache.get(uuid);
      if (cached !== undefined) {
        result = cached ?? undefined;
        break;
      }
      if (seen.has(uuid)) break; // cycle in parentUuid links
      seen.add(uuid);
      path.push(uuid);
    }
    const own = explicitAgent(current);
    if (own !== undefined) {
      result = own;
      break;
    }
    const parentUuid = asString(current["parentUuid"]);
    const parent = parentUuid === undefined ? undefined : ctx.byUuid.get(parentUuid);
    if (parentUuid === undefined || parent === undefined) break;
    const spawned = ctx.spawners.get(parentUuid);
    if (spawned !== undefined && current["isSidechain"] === true) {
      result = spawned;
      break;
    }
    current = parent;
  }

  for (const id of path) ctx.cache.set(id, result ?? null);
  return result;
}

/** Claude Code writes one log line per content block, repeating the same usage; `message.id|requestId` is one billed call. */
function callKey(record: UnknownRecord, message: UnknownRecord, lineNo: number): string {
  const messageId = asString(message["id"]);
  const requestId = asString(record["requestId"]);
  if (messageId !== undefined && requestId !== undefined) return `${messageId}|${requestId}`;
  return asString(record["uuid"]) ?? `line-${lineNo}`;
}

/**
 * Parse a Claude Code session log (`~/.claude/projects/**\/*.jsonl`) into billed-call telemetry.
 *
 * - One event per distinct API call: repeated per-content-block lines are collapsed, keeping the
 *   largest `output_tokens` (streamed duplicates may carry partial counts).
 * - Latency = parent line timestamp -> last content block of the response.
 * - Subagent attribution: explicit tags, then Task-call lineage; see `resolveAgent`.
 * Malformed lines never throw: they become warnings and parsing continues.
 */
export function parseClaudeCodeJsonl(text: string, options: ParseJsonlOptions = {}): ParseResult {
  const warnings: ParseWarning[] = [];
  const records: { lineNo: number; record: UnknownRecord }[] = [];
  let recordsRead = 0;

  const rawLines = text.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i];
    if (raw === undefined || raw.trim() === "") continue;
    recordsRead += 1;
    const lineNo = i + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      warnings.push({ line: lineNo, code: "invalid_json", message: "line is not valid JSON" });
      continue;
    }
    if (!isRecord(parsed)) {
      warnings.push({ line: lineNo, code: "invalid_record", message: "line is not a JSON object" });
      continue;
    }
    records.push({ lineNo, record: parsed });
  }

  const byUuid = new Map<string, UnknownRecord>();
  const spawners = new Map<string, AgentName>();
  for (const { record } of records) {
    const uuid = asString(record["uuid"]);
    if (uuid === undefined) continue;
    byUuid.set(uuid, record);
    if (record["type"] === "assistant") {
      const spawned = spawnedAgent(record);
      if (spawned !== undefined) spawners.set(uuid, spawned);
    }
  }

  let ignored = 0;
  const groups = new Map<string, Candidate[]>();
  for (const { lineNo, record } of records) {
    if (record["type"] !== "assistant") {
      ignored += 1;
      continue;
    }
    const message = record["message"];
    if (!isRecord(message)) {
      warnings.push({ line: lineNo, code: "invalid_record", message: "assistant line has no message object" });
      continue;
    }
    const model = asString(message["model"]);
    if (model === SYNTHETIC_MODEL) {
      ignored += 1;
      continue;
    }
    if (model === undefined) {
      warnings.push({ line: lineNo, code: "invalid_record", message: "assistant message has no model" });
      continue;
    }
    const usage = parseApiUsage(message["usage"]);
    if (!usage.ok) {
      warnings.push({ line: lineNo, code: usage.code, message: usage.message });
      continue;
    }
    const ms = parseTimestamp(record["timestamp"]);
    if (ms === undefined) {
      warnings.push({ line: lineNo, code: "invalid_timestamp", message: "assistant line has no parseable timestamp" });
      continue;
    }
    const key = callKey(record, message, lineNo);
    const candidate: Candidate = { lineNo, record, ms, usage: usage.usage, model };
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [candidate]);
    else group.push(candidate);
  }

  const ctx: AttributionContext = { byUuid, spawners, cache: new Map() };
  const events: TelemetryEvent[] = [];
  let duplicatesDropped = 0;

  for (const [key, group] of groups) {
    const first = group[0];
    if (first === undefined) continue;
    duplicatesDropped += group.length - 1;

    let best = first;
    let lastMs = first.ms;
    for (const candidate of group) {
      if (candidate.usage.outputTokens > best.usage.outputTokens) best = candidate;
      if (candidate.ms > lastMs) lastMs = candidate.ms;
    }

    const parentUuid = asString(first.record["parentUuid"]);
    const parent = parentUuid === undefined ? undefined : byUuid.get(parentUuid);
    const parentMs = parent === undefined ? undefined : parseTimestamp(parent["timestamp"]);
    const latencyMs = parentMs === undefined ? null : Math.max(0, lastMs - parentMs);

    const calls = group
      .flatMap((candidate) => toolUses(candidate.record))
      .map((block) => `${asString(block["name"]) ?? "?"}:${stableStringify(block["input"])}`);
    const fingerprint = calls.length === 0 ? undefined : fnv1a(calls.join("\u0001"));

    events.push({
      id: key,
      timestamp: new Date(lastMs).toISOString(),
      sessionId: asString(first.record["sessionId"]) ?? options.sessionId ?? "unknown-session",
      agent: resolveAgent(first.record, ctx) ?? UNATTRIBUTED,
      model: first.model,
      usage: best.usage,
      latencyMs,
      source: "claude-code-log",
      ...(fingerprint === undefined ? {} : { fingerprint }),
    });
  }

  const sorted = sortEvents(events);
  warnings.sort((a, b) => a.line - b.line);
  return { events: sorted, warnings, stats: makeStats(recordsRead, sorted.length, duplicatesDropped, ignored) };
}
