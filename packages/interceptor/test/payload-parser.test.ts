import { describe, expect, it } from "vitest";
import { parseApiPayloadText, parseApiPayloads } from "../src/payload-parser";

const base = {
  id: "msg_a",
  agent: "PM_Agent",
  model: "claude-sonnet-5-5",
  session_id: "s1",
  timestamp: "2026-11-25T10:00:00.000Z",
  latency_ms: 1200,
  usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
};

describe("parseApiPayloads", () => {
  it("maps a multi-agent API payload to a telemetry event", () => {
    const result = parseApiPayloads([{ ...base, feature_id: "feat-1", milestone: "feature_shipped", fingerprint: "abc" }]);
    expect(result.warnings).toEqual([]);
    expect(result.events).toEqual([
      {
        id: "msg_a",
        timestamp: "2026-11-25T10:00:00.000Z",
        sessionId: "s1",
        agent: "PM_Agent",
        model: "claude-sonnet-5-5",
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 900, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 },
        latencyMs: 1200,
        source: "api-payload",
        featureId: "feat-1",
        milestone: "feature_shipped",
        fingerprint: "abc",
      },
    ]);
  });

  it("normalises agent spelling and reads cache tiers", () => {
    const result = parseApiPayloads([
      {
        ...base,
        agent: "architect-agent",
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 30,
          cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 },
        },
      },
    ]);
    expect(result.events[0]?.agent).toBe("Architect_Agent");
    expect(result.events[0]?.usage.cacheWrite5mTokens).toBe(10);
    expect(result.events[0]?.usage.cacheWrite1hTokens).toBe(20);
  });

  it("keeps an event whose agent is unknown, labels it Unattributed, and warns", () => {
    const result = parseApiPayloads([{ ...base, agent: "Intern_Agent" }]);
    expect(result.events[0]?.agent).toBe("Unattributed");
    expect(result.warnings[0]).toMatchObject({ code: "unknown_agent", line: 1 });
  });

  it("sets latencyMs to null when the payload carries none", () => {
    const { latency_ms: _omit, ...noLatency } = base;
    expect(parseApiPayloads([noLatency]).events[0]?.latencyMs).toBeNull();
  });

  it("rejects payloads without a usage object, with non-object shape, or with bad numbers", () => {
    const { usage: _omit, ...noUsage } = base;
    const result = parseApiPayloads([noUsage, "nope", { ...base, id: "x", usage: { input_tokens: 1.5 } }]);
    expect(result.events).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toEqual(["missing_usage", "invalid_record", "invalid_usage"]);
    expect(result.warnings.map((w) => w.line)).toEqual([1, 2, 3]);
  });

  it("rejects payloads that lack a model id", () => {
    const { model: _omit, ...noModel } = base;
    const result = parseApiPayloads([noModel]);
    expect(result.events).toEqual([]);
    expect(result.warnings[0]).toMatchObject({ code: "invalid_record" });
  });

  it("drops payloads that repeat an id and reports them in stats", () => {
    const result = parseApiPayloads([base, { ...base, timestamp: "2026-11-25T10:00:09.000Z" }]);
    expect(result.events).toHaveLength(1);
    expect(result.stats).toEqual({ recordsRead: 2, eventsParsed: 1, duplicatesDropped: 1, ignored: 0 });
  });

  it("returns events sorted by timestamp", () => {
    const result = parseApiPayloads([
      { ...base, id: "late", timestamp: "2026-11-25T10:00:30.000Z" },
      { ...base, id: "early", timestamp: "2026-11-25T10:00:10.000Z" },
    ]);
    expect(result.events.map((e) => e.id)).toEqual(["early", "late"]);
  });

  it("falls back to a deterministic positional id when a payload has none", () => {
    const { id: _omit, ...noId } = base;
    const a = parseApiPayloads([noId]).events[0]?.id;
    const b = parseApiPayloads([noId]).events[0]?.id;
    expect(a).toBeDefined();
    expect(a).toBe(b);
  });
});

describe("parseApiPayloadText", () => {
  const one = (id: string) => JSON.stringify({ ...base, id });

  it("accepts a JSON array of payloads", () => {
    const result = parseApiPayloadText(`[${one("a")}, ${one("b")}]`);
    expect(result.events.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("accepts newline-delimited JSON and reports problems by their real file line number", () => {
    const { usage: _omit, ...noUsage } = base;
    const text = [one("a"), "{bad json", JSON.stringify({ ...noUsage, id: "c" })].join("\n");
    const result = parseApiPayloadText(text);
    expect(result.events.map((e) => e.id)).toEqual(["a"]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ line: 2, code: "invalid_json" }),
      expect.objectContaining({ line: 3, code: "missing_usage" }),
    ]);
  });

  it("reports a malformed JSON array as one invalid_json warning and no events", () => {
    const result = parseApiPayloadText("[{\"id\": ");
    expect(result.events).toEqual([]);
    expect(result.warnings).toEqual([expect.objectContaining({ line: 1, code: "invalid_json" })]);
  });

  it("returns an empty result for blank input", () => {
    expect(parseApiPayloadText("  \n ")).toEqual({
      events: [],
      warnings: [],
      stats: { recordsRead: 0, eventsParsed: 0, duplicatesDropped: 0, ignored: 0 },
    });
  });
});
