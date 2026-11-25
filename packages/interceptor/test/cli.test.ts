import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli";
import type { CliIO } from "../src/cli";
import { createNodeIO } from "../src/node-io";
import { assistantRecord, toJsonl, toolUse } from "./helpers";

function fakeIO(files: Record<string, string>): { io: CliIO; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      readText: async (path) => {
        const text = files[path];
        if (text === undefined) throw new Error(`ENOENT: no such file '${path}'`);
        return text;
      },
      expandPaths: async (paths) => [...paths],
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
    },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

const pmUsage = { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 9_000, cache_creation_input_tokens: 0 };
const architectUsage = { input_tokens: 2_000, output_tokens: 1_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 8_000 };

const pmCall = (uuid: string, parent: string | null, ts: string) =>
  assistantRecord({ uuid, parentUuid: parent, messageId: "m1", requestId: "r1", timestamp: ts, usage: pmUsage, extra: { agentName: "PM_Agent" } });

const sessionLog = toJsonl([
  pmCall("p1", null, "2026-11-25T10:00:01.000Z"),
  pmCall("p2", "p1", "2026-11-25T10:00:02.000Z"), // second content-block line of the same call
  assistantRecord({
    uuid: "a1",
    messageId: "m2",
    requestId: "r2",
    timestamp: "2026-11-25T10:00:03.000Z",
    model: "claude-opus-5-5",
    usage: architectUsage,
    extra: { agentName: "Architect_Agent" },
  }),
]);

describe("runCli — text report", () => {
  it("prints per-agent spend with correct dollars, cache hit rate and totals", async () => {
    const { io, out } = fakeIO({ "s.jsonl": sessionLog });
    const code = await runCli(["s.jsonl"], io);
    expect(code).toBe(0);
    expect(out()).toMatch(/PM_Agent\s+1\s+\$0\.0079\s+90\.0%/);
    expect(out()).toMatch(/Architect_Agent\s+1\s+\$0\.068\s+0\.0%/);
    expect(out()).toMatch(/TOTAL\s+2\s+\$0\.0759/);
  });

  it("reports how many records were read and how many duplicate lines were collapsed", async () => {
    const { io, out } = fakeIO({ "s.jsonl": sessionLog });
    await runCli(["s.jsonl"], io);
    expect(out()).toContain("2 billed call(s) from 3 record(s) in 1 file(s)");
    expect(out()).toContain("1 duplicate record(s) collapsed");
  });

  it("flags a runaway loop with the agent, repeat count and wasted dollars", async () => {
    const loop = toJsonl(
      Array.from({ length: 5 }, (_, i) =>
        assistantRecord({
          uuid: `l${i}`,
          messageId: `m${i}`,
          requestId: `r${i}`,
          timestamp: new Date(Date.parse("2026-11-25T10:00:00.000Z") + i * 10_000).toISOString(),
          usage: { input_tokens: 0, output_tokens: 1_000_000 },
          content: [toolUse(`t${i}`, "Bash", { command: "npm test" })],
          extra: { agentName: "Security_Agent" },
        }),
      ),
    );
    const { io, out } = fakeIO({ "loop.jsonl": loop });
    await runCli(["loop.jsonl"], io);
    expect(out()).toContain("Runaway loop: Security_Agent repeated the same call 5 times");
    expect(out()).toContain("wasted $40.00");
  });
});

describe("runCli — JSON output", () => {
  type Json = { summary: { totalCostUsd: number; calls: number }; stats: { duplicatesDropped: number }; loopAlerts: unknown[]; warnings: unknown[] };

  it("emits a machine-readable document with --json", async () => {
    const { io, out } = fakeIO({ "s.jsonl": sessionLog });
    expect(await runCli(["--json", "s.jsonl"], io)).toBe(0);
    const parsed = JSON.parse(out()) as Json;
    expect(parsed.summary.totalCostUsd).toBeCloseTo(0.0759, 10);
    expect(parsed.summary.calls).toBe(2);
    expect(parsed.stats.duplicatesDropped).toBe(1);
    expect(parsed.loopAlerts).toEqual([]);
  });

  it("merges several files and counts a call that appears in more than one file once", async () => {
    const { io, out } = fakeIO({ "a.jsonl": toJsonl([pmCall("p1", null, "2026-11-25T10:00:01.000Z")]), "b.jsonl": sessionLog });
    await runCli(["--json", "a.jsonl", "b.jsonl"], io);
    expect((JSON.parse(out()) as Json).summary.calls).toBe(2); // m1|r1 is in both files; m2|r2 only in b
  });
});

describe("runCli — payload format", () => {
  const payload = (id: string, ts: string) => ({
    id,
    agent: "Release_Agent",
    model: "claude-sonnet-5-5",
    session_id: "s",
    timestamp: ts,
    usage: { input_tokens: 10, output_tokens: 10 },
  });

  it("reads a JSON array when --format payload is given", async () => {
    const files = { "p.json": JSON.stringify([payload("a", "2026-11-25T10:00:00.000Z"), payload("b", "2026-11-25T10:00:01.000Z")]) };
    const { io, out } = fakeIO(files);
    expect(await runCli(["--format", "payload", "--json", "p.json"], io)).toBe(0);
    expect((JSON.parse(out()) as { summary: { calls: number } }).summary.calls).toBe(2);
  });

  it("accepts --format=payload and newline-delimited JSON", async () => {
    const ndjson = [payload("a", "2026-11-25T10:00:00.000Z"), payload("b", "2026-11-25T10:00:01.000Z")].map((p) => JSON.stringify(p)).join("\n");
    const { io, out } = fakeIO({ "p.ndjson": ndjson });
    expect(await runCli(["--format=payload", "--json", "p.ndjson"], io)).toBe(0);
    expect((JSON.parse(out()) as { summary: { calls: number } }).summary.calls).toBe(2);
  });
});

describe("runCli — diagnostics and exit codes", () => {
  it("prints usage and exits 2 when no path is given", async () => {
    const { io, err } = fakeIO({});
    expect(await runCli([], io)).toBe(2);
    expect(err()).toContain("Usage");
  });

  it("exits 2 and names an unknown flag", async () => {
    const { io, err } = fakeIO({});
    expect(await runCli(["--bogus", "x.jsonl"], io)).toBe(2);
    expect(err()).toContain("--bogus");
  });

  it("exits 2 and names an invalid --format value", async () => {
    const { io, err } = fakeIO({});
    expect(await runCli(["--format", "xml", "x.jsonl"], io)).toBe(2);
    expect(err()).toContain("xml");
  });

  it("prints help to stdout and exits 0 for --help", async () => {
    const { io, out } = fakeIO({});
    expect(await runCli(["--help"], io)).toBe(0);
    expect(out()).toContain("Usage");
  });

  it("exits 1 and names the file when it cannot be read", async () => {
    const { io, err } = fakeIO({});
    expect(await runCli(["missing.jsonl"], io)).toBe(1);
    expect(err()).toContain("missing.jsonl");
  });

  it("exits 1 when the input holds no billed calls", async () => {
    const { io, err } = fakeIO({ "empty.jsonl": toJsonl([{ type: "user", uuid: "u", timestamp: "2026-11-25T10:00:00.000Z" }]) });
    expect(await runCli(["empty.jsonl"], io)).toBe(1);
    expect(err()).toContain("no billed calls");
  });

  it("sends parse warnings to stderr as file:line and still succeeds", async () => {
    const good = JSON.stringify(pmCall("p1", null, "2026-11-25T10:00:01.000Z"));
    const { io, err } = fakeIO({ "f.jsonl": `${good}\n{broken\n` });
    expect(await runCli(["f.jsonl"], io)).toBe(0);
    expect(err()).toContain("f.jsonl:2 invalid_json");
  });
});

describe("createNodeIO", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("expands directories to their .jsonl files recursively, sorted, and passes files through", async () => {
    dir = await mkdtemp(join(tmpdir(), "finops-"));
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "b.jsonl"), "x");
    await writeFile(join(dir, "a.jsonl"), "x");
    await writeFile(join(dir, "sub", "c.jsonl"), "x");
    await writeFile(join(dir, "notes.txt"), "x");
    const io = createNodeIO();
    expect(await io.expandPaths([dir])).toEqual([join(dir, "a.jsonl"), join(dir, "b.jsonl"), join(dir, "sub", "c.jsonl")]);
    expect(await io.expandPaths([join(dir, "notes.txt")])).toEqual([join(dir, "notes.txt")]);
    expect(await io.readText(join(dir, "a.jsonl"))).toBe("x");
  });
});
