import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as api from "../src/index";

const SRC = join(import.meta.dirname, "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : [],
  );
}
const files = sourceFiles(SRC);
const read = (f: string): string => readFileSync(f, "utf8");

describe("architecture rules (from CLAUDE.md)", () => {
  it("finds the source files it is meant to police", () => {
    expect(files.length).toBeGreaterThan(12);
  });

  it("is pure: no Node imports anywhere, so the router runs in the browser and cannot touch the filesystem", () => {
    expect(files.filter((f) => /from\s+["'](node:|fs|path|os|child_process|net|http)/.test(read(f)))).toEqual([]);
  });

  it("depends on the interceptor only through its public entry point", () => {
    const deep = files.filter((f) => /@ai-finops\/interceptor\/|interceptor\/src/.test(read(f)));
    expect(deep).toEqual([]);
  });

  it("never imports from the dashboard", () => {
    expect(files.filter((f) => /@ai-finops\/dashboard/.test(read(f)))).toEqual([]);
  });

  it("never reads the clock or randomness, so routing is deterministic", () => {
    const nondeterministic = /\bDate\.now\b|new Date\(\)|\bMath\.random\b|performance\.now|crypto\.random/;
    expect(files.filter((f) => nondeterministic.test(read(f)))).toEqual([]);
  });

  it("uses no `any` and no ts-ignore / ts-expect-error", () => {
    const pattern = /\bas any\b|:\s*any\b|<any>|\bany\[\]|@ts-ignore|@ts-expect-error/;
    expect(files.filter((f) => pattern.test(read(f)))).toEqual([]);
  });

  it("has no TODO placeholders in core logic", () => {
    expect(files.filter((f) => /\bTODO\b|\bFIXME\b/.test(read(f)))).toEqual([]);
  });
});

describe("public API (index.ts)", () => {
  it("exposes the router, rules, scripts and ROI helpers the dashboard relies on", () => {
    for (const name of ["createRouter", "estimateTokens", "summarizeOffloads", "combineSavings", "formatJson", "lintFiles", "grepFiles", "summarizeTestOutput", "validateJsonSchema"] as const) {
      expect(typeof api[name], name).toBe("function");
    }
    expect(api.RULE_IDS).toEqual(["json-format", "test-summary", "lint-check", "grep-search"]);
    expect(api.DEFAULT_RULES.map((r) => r.id)).toEqual(["json-format", "test-summary", "lint-check", "grep-search"]);
  });
});
