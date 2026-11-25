import { parseApiUsage } from "./anthropic-usage";
import { normalizeAgentName } from "./attribution";
import { asString, isRecord } from "./guards";
import { makeStats, parseTimestamp, sortEvents } from "./parse-common";
import { UNATTRIBUTED } from "./types";
import type { AgentLabel, Milestone, ParseResult, ParseWarning, TelemetryEvent } from "./types";

/**
 * Simulated / proxied multi-agent API payload (one per model call):
 *
 *   {
 *     "id": "msg_01...",                 // optional; de-duplication key
 *     "agent": "PM_Agent",               // optional; PM_Agent | Architect_Agent | Security_Agent | Release_Agent
 *     "model": "claude-sonnet-5-5",
 *     "session_id": "sprint-1",
 *     "timestamp": "2026-11-25T10:00:00Z",
 *     "latency_ms": 1200,                // optional
 *     "feature_id": "feat-42",           // optional
 *     "milestone": "feature_shipped",    // optional
 *     "fingerprint": "ab12cd34",         // optional; request hash for loop detection
 *     "usage": { ...Anthropic API usage object... }
 *   }
 */

function readLatency(payload: Record<string, unknown>): number | null {
  const raw = payload["latency_ms"] ?? payload["latencyMs"];
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
}

export function parseApiPayloads(payloads: readonly unknown[]): ParseResult {
  const warnings: ParseWarning[] = [];
  const events: TelemetryEvent[] = [];
  const seen = new Set<string>();
  let duplicatesDropped = 0;

  payloads.forEach((payload, index) => {
    const line = index + 1;
    if (!isRecord(payload)) {
      warnings.push({ line, code: "invalid_record", message: "payload is not an object" });
      return;
    }
    const model = asString(payload["model"]);
    if (model === undefined) {
      warnings.push({ line, code: "invalid_record", message: "payload has no model" });
      return;
    }
    const usage = parseApiUsage(payload["usage"]);
    if (!usage.ok) {
      warnings.push({ line, code: usage.code, message: usage.message });
      return;
    }
    const ms = parseTimestamp(payload["timestamp"]);
    if (ms === undefined) {
      warnings.push({ line, code: "invalid_timestamp", message: "payload has no parseable timestamp" });
      return;
    }

    const id = asString(payload["id"]) ?? `payload-${index}`;
    if (seen.has(id)) {
      duplicatesDropped += 1;
      return;
    }
    seen.add(id);

    const rawAgent = payload["agent"];
    let agent: AgentLabel = UNATTRIBUTED;
    if (rawAgent !== undefined) {
      const normalized = normalizeAgentName(rawAgent);
      if (normalized === undefined) {
        warnings.push({ line, code: "unknown_agent", message: `unknown agent ${JSON.stringify(rawAgent)}` });
      } else {
        agent = normalized;
      }
    }

    const featureId = asString(payload["feature_id"] ?? payload["featureId"]);
    const milestone: Milestone | undefined = payload["milestone"] === "feature_shipped" ? "feature_shipped" : undefined;
    const fingerprint = asString(payload["fingerprint"]);

    events.push({
      id,
      timestamp: new Date(ms).toISOString(),
      sessionId: asString(payload["session_id"] ?? payload["sessionId"]) ?? "unknown-session",
      agent,
      model,
      usage: usage.usage,
      latencyMs: readLatency(payload),
      source: "api-payload",
      ...(featureId === undefined ? {} : { featureId }),
      ...(milestone === undefined ? {} : { milestone }),
      ...(fingerprint === undefined ? {} : { fingerprint }),
    });
  });

  const sorted = sortEvents(events);
  return { events: sorted, warnings, stats: makeStats(payloads.length, sorted.length, duplicatesDropped, 0) };
}

/**
 * Parse payloads from text: either one JSON array, or newline-delimited JSON (one payload per line).
 * Warnings report the real line number in the text for NDJSON input.
 */
export function parseApiPayloadText(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { events: [], warnings: [], stats: makeStats(0, 0, 0, 0) };

  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      const warning: ParseWarning = { line: 1, code: "invalid_json", message: "payload array is not valid JSON" };
      return { events: [], warnings: [warning], stats: makeStats(1, 0, 0, 0) };
    }
    return parseApiPayloads(Array.isArray(parsed) ? (parsed as unknown[]) : [parsed]);
  }

  const entries: { lineNo: number; value: unknown }[] = [];
  const warnings: ParseWarning[] = [];
  let invalidLines = 0;
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === "") return;
    try {
      entries.push({ lineNo: i + 1, value: JSON.parse(raw) });
    } catch {
      invalidLines += 1;
      warnings.push({ line: i + 1, code: "invalid_json", message: "line is not valid JSON" });
    }
  });

  const inner = parseApiPayloads(entries.map((entry) => entry.value));
  for (const warning of inner.warnings) {
    warnings.push({ ...warning, line: entries[warning.line - 1]?.lineNo ?? warning.line });
  }
  warnings.sort((a, b) => a.line - b.line);
  return {
    events: inner.events,
    warnings,
    stats: makeStats(inner.stats.recordsRead + invalidLines, inner.stats.eventsParsed, inner.stats.duplicatesDropped, 0),
  };
}
