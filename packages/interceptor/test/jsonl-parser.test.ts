import { describe, expect, it } from "vitest";
import { parseClaudeCodeJsonl } from "../src/jsonl-parser";
import { assistantRecord, toJsonl, toolUse, userRecord } from "./helpers";

const T0 = "2026-11-25T10:00:00.000Z";
const at = (seconds: number): string => new Date(Date.parse(T0) + seconds * 1000).toISOString();

describe("parseClaudeCodeJsonl — field mapping", () => {
  it("turns an assistant line into a telemetry event with tiered cache usage", () => {
    const text = toJsonl([
      assistantRecord({
        uuid: "a1",
        messageId: "msg_1",
        requestId: "req_1",
        timestamp: at(5),
        usage: {
          input_tokens: 2,
          output_tokens: 800,
          cache_read_input_tokens: 61_517,
          cache_creation_input_tokens: 55_115,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 55_115 },
        },
      }),
    ]);

    const result = parseClaudeCodeJsonl(text);

    expect(result.warnings).toEqual([]);
    expect(result.events).toEqual([
      {
        id: "msg_1|req_1",
        timestamp: at(5),
        sessionId: "sess-1",
        agent: "Unattributed",
        model: "claude-sonnet-5-5",
        usage: {
          inputTokens: 2,
          outputTokens: 800,
          cacheReadTokens: 61_517,
          cacheWrite5mTokens: 0,
          cacheWrite1hTokens: 55_115,
        },
        latencyMs: null,
        source: "claude-code-log",
      },
    ]);
  });

  it("splits cache_creation into 5m and 1h tiers when both are present", () => {
    const text = toJsonl([
      assistantRecord({
        uuid: "a1",
        messageId: "m",
        requestId: "r",
        timestamp: at(1),
        usage: {
          input_tokens: 0,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 300,
          cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
        },
      }),
    ]);
    const usage = parseClaudeCodeJsonl(text).events[0]?.usage;
    expect(usage?.cacheWrite5mTokens).toBe(100);
    expect(usage?.cacheWrite1hTokens).toBe(200);
  });

  it("assigns cache-write tokens the tier breakdown does not explain to the 5m tier so no billed tokens are lost", () => {
    const text = toJsonl([
      assistantRecord({
        uuid: "a1",
        messageId: "m",
        requestId: "r",
        timestamp: at(1),
        usage: {
          input_tokens: 0,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 300,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 200 },
        },
      }),
    ]);
    const usage = parseClaudeCodeJsonl(text).events[0]?.usage;
    expect(usage?.cacheWrite1hTokens).toBe(200);
    expect(usage?.cacheWrite5mTokens).toBe(100);
  });

  it("bills all cache_creation_input_tokens as 5-minute writes when no tier breakdown exists", () => {
    const text = toJsonl([
      assistantRecord({
        uuid: "a1",
        messageId: "m",
        requestId: "r",
        timestamp: at(1),
        usage: { input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 300 },
      }),
    ]);
    const usage = parseClaudeCodeJsonl(text).events[0]?.usage;
    expect(usage?.cacheWrite5mTokens).toBe(300);
    expect(usage?.cacheWrite1hTokens).toBe(0);
  });

  it("treats absent usage counters as zero", () => {
    const text = toJsonl([
      assistantRecord({ uuid: "a1", messageId: "m", requestId: "r", timestamp: at(1), usage: { output_tokens: 7 } }),
    ]);
    expect(parseClaudeCodeJsonl(text).events[0]?.usage).toEqual({
      inputTokens: 0,
      outputTokens: 7,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
    });
  });

  it("uses the provided sessionId option only when a line carries none", () => {
    const rec = assistantRecord({ uuid: "a1", messageId: "m", requestId: "r", timestamp: at(1) });
    delete rec["sessionId"];
    const result = parseClaudeCodeJsonl(toJsonl([rec]), { sessionId: "from-filename" });
    expect(result.events[0]?.sessionId).toBe("from-filename");
  });
});

describe("parseClaudeCodeJsonl — de-duplication (real logs repeat usage once per content block)", () => {
  it("counts a multi-block message once", () => {
    // Real logs write one line per content block (thinking / text / tool_use / tool_use), each repeating the same usage.
    const blocks = ["thinking", "text", "tool_use", "tool_use"] as const;
    const text = toJsonl(
      blocks.map((type, i) =>
        assistantRecord({
          uuid: `a${i}`,
          parentUuid: i === 0 ? null : `a${i - 1}`,
          messageId: "msg_1",
          requestId: "req_1",
          timestamp: at(i),
          content: [{ type, text: "x" }],
        }),
      ),
    );

    const result = parseClaudeCodeJsonl(text);

    expect(result.events).toHaveLength(1);
    expect(result.stats).toEqual({ recordsRead: 4, eventsParsed: 1, duplicatesDropped: 3, ignored: 0 });
    expect(result.events[0]?.usage.outputTokens).toBe(20);
  });

  it("keeps the largest output_tokens when streamed duplicates disagree", () => {
    const mk = (uuid: string, out: number, ts: number) =>
      assistantRecord({
        uuid,
        messageId: "msg_1",
        requestId: "req_1",
        timestamp: at(ts),
        usage: { input_tokens: 5, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      });
    const result = parseClaudeCodeJsonl(toJsonl([mk("a1", 2, 1), mk("a2", 640, 2), mk("a3", 640, 3)]));
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.usage.outputTokens).toBe(640);
  });

  it("does not merge different requests that share a message id", () => {
    const text = toJsonl([
      assistantRecord({ uuid: "a1", messageId: "msg_1", requestId: "req_1", timestamp: at(1) }),
      assistantRecord({ uuid: "a2", messageId: "msg_1", requestId: "req_2", timestamp: at(2) }),
    ]);
    expect(parseClaudeCodeJsonl(text).events).toHaveLength(2);
  });
});

describe("parseClaudeCodeJsonl — robustness", () => {
  it("ignores non-assistant lines without warning", () => {
    const text = toJsonl([
      userRecord({ uuid: "u1", timestamp: at(0) }),
      { type: "attachment", uuid: "x", timestamp: at(0) },
      assistantRecord({ uuid: "a1", parentUuid: "u1", messageId: "m", requestId: "r", timestamp: at(1) }),
    ]);
    const result = parseClaudeCodeJsonl(text);
    expect(result.warnings).toEqual([]);
    expect(result.stats.ignored).toBe(2);
    expect(result.events).toHaveLength(1);
  });

  it("ignores Claude Code's synthetic error messages", () => {
    const text = toJsonl([
      assistantRecord({ uuid: "a1", messageId: "m", requestId: "r", timestamp: at(1), model: "<synthetic>" }),
    ]);
    const result = parseClaudeCodeJsonl(text);
    expect(result.events).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("reports an invalid JSON line with its 1-based line number and keeps parsing", () => {
    const good = JSON.stringify(assistantRecord({ uuid: "a1", messageId: "m", requestId: "r", timestamp: at(1) }));
    const result = parseClaudeCodeJsonl(`${good}\n{not json\n`);
    expect(result.events).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ line: 2, code: "invalid_json" });
  });

  it("rejects an assistant line with negative token counts and says so", () => {
    const text = toJsonl([
      assistantRecord({
        uuid: "a1",
        messageId: "m",
        requestId: "r",
        timestamp: at(1),
        usage: { input_tokens: -5, output_tokens: 1 },
      }),
    ]);
    const result = parseClaudeCodeJsonl(text);
    expect(result.events).toEqual([]);
    expect(result.warnings[0]).toMatchObject({ line: 1, code: "invalid_usage" });
  });

  it("rejects an assistant line with an unparseable timestamp", () => {
    const text = toJsonl([assistantRecord({ uuid: "a1", messageId: "m", requestId: "r", timestamp: "yesterday-ish" })]);
    const result = parseClaudeCodeJsonl(text);
    expect(result.events).toEqual([]);
    expect(result.warnings[0]).toMatchObject({ code: "invalid_timestamp" });
  });

  it("warns when an assistant message has no usage object", () => {
    const rec = assistantRecord({ uuid: "a1", messageId: "m", requestId: "r", timestamp: at(1) });
    const message = rec["message"] as Record<string, unknown>;
    delete message["usage"];
    const result = parseClaudeCodeJsonl(toJsonl([rec]));
    expect(result.events).toEqual([]);
    expect(result.warnings[0]).toMatchObject({ code: "missing_usage" });
  });

  it("tolerates CRLF line endings and blank lines", () => {
    const line = JSON.stringify(assistantRecord({ uuid: "a1", messageId: "m", requestId: "r", timestamp: at(1) }));
    const result = parseClaudeCodeJsonl(`\r\n${line}\r\n\r\n`);
    expect(result.events).toHaveLength(1);
    expect(result.stats.recordsRead).toBe(1);
  });

  it("returns events sorted by timestamp regardless of file order", () => {
    const text = toJsonl([
      assistantRecord({ uuid: "a2", messageId: "m2", requestId: "r2", timestamp: at(20) }),
      assistantRecord({ uuid: "a1", messageId: "m1", requestId: "r1", timestamp: at(10) }),
    ]);
    expect(parseClaudeCodeJsonl(text).events.map((e) => e.id)).toEqual(["m1|r1", "m2|r2"]);
  });
});

describe("parseClaudeCodeJsonl — latency", () => {
  it("measures from the parent line to the last content block of the response", () => {
    const text = toJsonl([
      userRecord({ uuid: "u1", timestamp: at(0) }),
      assistantRecord({ uuid: "a1", parentUuid: "u1", messageId: "m", requestId: "r", timestamp: at(2) }),
      assistantRecord({ uuid: "a2", parentUuid: "a1", messageId: "m", requestId: "r", timestamp: new Date(Date.parse(T0) + 4500).toISOString() }),
    ]);
    expect(parseClaudeCodeJsonl(text).events[0]?.latencyMs).toBe(4500);
  });

  it("is null when the parent line is not in the file", () => {
    const text = toJsonl([
      assistantRecord({ uuid: "a1", parentUuid: "missing", messageId: "m", requestId: "r", timestamp: at(2) }),
    ]);
    expect(parseClaudeCodeJsonl(text).events[0]?.latencyMs).toBeNull();
  });

  it("never reports negative latency when clocks disagree", () => {
    const text = toJsonl([
      userRecord({ uuid: "u1", timestamp: at(10) }),
      assistantRecord({ uuid: "a1", parentUuid: "u1", messageId: "m", requestId: "r", timestamp: at(5) }),
    ]);
    expect(parseClaudeCodeJsonl(text).events[0]?.latencyMs).toBe(0);
  });
});

describe("parseClaudeCodeJsonl — subagent attribution", () => {
  it("uses an explicit agent tag on the line (and normalises its spelling)", () => {
    const text = toJsonl([
      assistantRecord({ uuid: "a1", messageId: "m", requestId: "r", timestamp: at(1), extra: { agentName: "security-agent" } }),
    ]);
    expect(parseClaudeCodeJsonl(text).events[0]?.agent).toBe("Security_Agent");
  });

  it("attributes sidechain lines to the subagent named by the Task call that spawned them", () => {
    const text = toJsonl([
      userRecord({ uuid: "u0", timestamp: at(0) }),
      assistantRecord({
        uuid: "main1",
        parentUuid: "u0",
        messageId: "m1",
        requestId: "r1",
        timestamp: at(1),
        content: [toolUse("toolu_1", "Task", { subagent_type: "Architect_Agent", prompt: "design it" })],
      }),
      assistantRecord({ uuid: "side1", parentUuid: "main1", isSidechain: true, messageId: "m2", requestId: "r2", timestamp: at(2) }),
      assistantRecord({ uuid: "side2", parentUuid: "side1", isSidechain: true, messageId: "m3", requestId: "r3", timestamp: at(3) }),
      userRecord({ uuid: "tr1", parentUuid: "main1", timestamp: at(4), content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "done" }] }),
      assistantRecord({ uuid: "main2", parentUuid: "tr1", messageId: "m4", requestId: "r4", timestamp: at(5) }),
    ]);

    const byId = new Map(parseClaudeCodeJsonl(text).events.map((e) => [e.id, e.agent]));

    expect(byId.get("m1|r1")).toBe("Unattributed"); // the orchestrator that spawned the Task
    expect(byId.get("m2|r2")).toBe("Architect_Agent");
    expect(byId.get("m3|r3")).toBe("Architect_Agent");
    expect(byId.get("m4|r4")).toBe("Unattributed"); // main thread resumes after the Task result: not the subagent
  });

  it("inherits an explicit agent tag from an ancestor in the parent chain", () => {
    const text = toJsonl([
      assistantRecord({ uuid: "a1", messageId: "m1", requestId: "r1", timestamp: at(1), extra: { agent: "Release_Agent" } }),
      assistantRecord({ uuid: "a2", parentUuid: "a1", isSidechain: true, messageId: "m2", requestId: "r2", timestamp: at(2) }),
    ]);
    const byId = new Map(parseClaudeCodeJsonl(text).events.map((e) => [e.id, e.agent]));
    expect(byId.get("m2|r2")).toBe("Release_Agent");
  });

  it("falls back to Unattributed when a Task names an unrelated subagent type", () => {
    const text = toJsonl([
      assistantRecord({
        uuid: "main1",
        messageId: "m1",
        requestId: "r1",
        timestamp: at(1),
        content: [toolUse("t", "Task", { subagent_type: "general-purpose" })],
      }),
      assistantRecord({ uuid: "side1", parentUuid: "main1", isSidechain: true, messageId: "m2", requestId: "r2", timestamp: at(2) }),
    ]);
    const byId = new Map(parseClaudeCodeJsonl(text).events.map((e) => [e.id, e.agent]));
    expect(byId.get("m2|r2")).toBe("Unattributed");
  });

  it("survives a cycle in parentUuid links without hanging", () => {
    const text = toJsonl([
      assistantRecord({ uuid: "a1", parentUuid: "a2", messageId: "m1", requestId: "r1", timestamp: at(1) }),
      assistantRecord({ uuid: "a2", parentUuid: "a1", messageId: "m2", requestId: "r2", timestamp: at(2) }),
    ]);
    expect(parseClaudeCodeJsonl(text).events).toHaveLength(2);
  });
});

describe("parseClaudeCodeJsonl — request fingerprints (for runaway-loop detection)", () => {
  const bash = (command: string) => [toolUse("t", "Bash", { command })];
  const fp = (content: readonly Record<string, unknown>[]): string | undefined =>
    parseClaudeCodeJsonl(toJsonl([assistantRecord({ uuid: "a", messageId: "m", requestId: "r", timestamp: at(1), content })])).events[0]
      ?.fingerprint;

  it("is identical for identical tool calls and different for different inputs", () => {
    expect(fp(bash("npm test"))).toBeDefined();
    expect(fp(bash("npm test"))).toBe(fp(bash("npm test")));
    expect(fp(bash("npm test"))).not.toBe(fp(bash("npm run lint")));
  });

  it("is absent when the message made no tool call", () => {
    expect(fp([{ type: "text", text: "just words" }])).toBeUndefined();
  });
});
