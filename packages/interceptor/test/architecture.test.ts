import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as api from "../src/index";

const SRC = join(import.meta.dirname, "..", "src");
const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
const read = (f: string): string => readFileSync(join(SRC, f), "utf8");

// The only modules allowed to touch Node: the I/O adapter and the executable entry point.
const NODE_ALLOWED = new Set(["node-io.ts", "bin.ts"]);

describe("architecture rules (from CLAUDE.md)", () => {
  it("finds the source files it is meant to police", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("keeps the library core free of node: imports so it runs in the browser", () => {
    const offenders = files.filter((f) => !NODE_ALLOWED.has(f) && /from\s+["'](node:|fs|path|os|child_process)/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("never imports from router or dashboard", () => {
    const offenders = files.filter((f) => /@ai-finops\/(router|dashboard)/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("uses no `any` and no ts-ignore / ts-expect-error", () => {
    const pattern = /\bas any\b|:\s*any\b|<any>|\bany\[\]|@ts-ignore|@ts-expect-error/;
    const offenders = files.filter((f) => pattern.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("has no TODO placeholders in core logic", () => {
    expect(files.filter((f) => /\bTODO\b|\bFIXME\b/.test(read(f)))).toEqual([]);
  });
});

describe("public API (index.ts)", () => {
  it("exposes the parsers, cost engine, analytics and constants the router and dashboard rely on", () => {
    for (const name of [
      "parseClaudeCodeJsonl",
      "parseApiPayloads",
      "parseApiPayloadText",
      "calculateCost",
      "cacheHitRate",
      "costOfEvent",
      "summarize",
      "computeBurnRate",
      "detectRunawayLoops",
      "resolvePricing",
      "makeUsage",
      "addUsage",
      "fnv1a",
      "formatUsd",
      "formatPct",
      "formatSummaryReport",
    ] as const) {
      expect(typeof api[name], name).toBe("function");
    }
    expect(api.AGENT_NAMES).toEqual(["PM_Agent", "Architect_Agent", "Security_Agent", "Release_Agent"]);
    expect(api.DEFAULT_PRICING["claude-sonnet-5-5"]?.inputPerMTok).toBe(2);
  });

  it("does not leak the CLI or Node adapter through the library entry point", () => {
    expect(Object.keys(api)).not.toContain("runCli");
    expect(Object.keys(api)).not.toContain("createNodeIO");
  });
});
