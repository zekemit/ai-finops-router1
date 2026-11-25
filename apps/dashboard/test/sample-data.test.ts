import { findUnsupportedKeywords, formatJson, grepFiles, compilePattern, lintFiles, summarizeTestOutput, validateJsonSchema } from "@ai-finops/router";
import { describe, expect, it } from "vitest";
import { createRng } from "../src/lib/rng";
import { SPEC_SCHEMA, sampleChangelogJson, sampleSourceFiles, sampleSpecJson, sampleVitestOutput } from "../src/lib/sample-data";

describe("sampleSourceFiles", () => {
  it("is deterministic per seed and produces realistic-sized TypeScript files", () => {
    const a = sampleSourceFiles(createRng(1), { count: 4, dirtiness: 0.3 });
    const b = sampleSourceFiles(createRng(1), { count: 4, dirtiness: 0.3 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(4);
    expect(a.every((f) => f.path.endsWith(".ts") && f.content.length > 1_500)).toBe(true);
    expect(new Set(a.map((f) => f.path)).size).toBe(4);
  });

  it("is lint-clean at dirtiness 0, for every seed", () => {
    for (let seed = 1; seed <= 15; seed += 1) {
      expect(lintFiles(sampleSourceFiles(createRng(seed), { count: 4, dirtiness: 0 }))).toEqual([]);
    }
  });

  it("puts at least one lint issue in every file at dirtiness 1", () => {
    const files = sampleSourceFiles(createRng(2), { count: 5, dirtiness: 1 });
    for (const file of files) expect(lintFiles([file]).length).toBeGreaterThan(0);
  });

  it("contains code the dashboard's search tasks can find", () => {
    const files = sampleSourceFiles(createRng(3), { count: 4, dirtiness: 0 });
    for (const pattern of ["export function", "throw new Error", "normalize"]) {
      const compiled = compilePattern(pattern, { regex: false, caseInsensitive: false });
      if (!compiled.ok) throw new Error(compiled.reason);
      expect(grepFiles(files, compiled.regex).totalMatches, pattern).toBeGreaterThan(0);
    }
  });
});

describe("sampleSpecJson", () => {
  const schemaIssues = (text: string) => validateJsonSchema(JSON.parse(text), SPEC_SCHEMA);

  it("uses a schema the router can fully evaluate", () => {
    expect(findUnsupportedKeywords(SPEC_SCHEMA)).toEqual([]);
  });

  it("flaw 'none' is valid JSON that satisfies the schema", () => {
    const text = sampleSpecJson(createRng(1), "F-101", "Usage export", "none");
    expect(formatJson(text, { mode: "pretty", indent: 2, sortKeys: false }).ok).toBe(true);
    expect(schemaIssues(text)).toEqual([]);
  });

  it("flaw 'syntax' is not parseable", () => {
    const text = sampleSpecJson(createRng(1), "F-101", "Usage export", "syntax");
    expect(formatJson(text, { mode: "pretty", indent: 2, sortKeys: false }).ok).toBe(false);
  });

  it("flaw 'schema' parses but violates the schema", () => {
    const text = sampleSpecJson(createRng(1), "F-101", "Usage export", "schema");
    expect(formatJson(text, { mode: "pretty", indent: 2, sortKeys: false }).ok).toBe(true);
    expect(schemaIssues(text).length).toBeGreaterThan(0);
  });
});

describe("sampleChangelogJson", () => {
  it("is valid JSON whose keys are not already sorted (so sorting visibly does something)", () => {
    const text = sampleChangelogJson(createRng(4), "F-101");
    const plain = formatJson(text, { mode: "minify", indent: 2, sortKeys: false });
    const sorted = formatJson(text, { mode: "minify", indent: 2, sortKeys: true });
    expect(plain.ok && sorted.ok).toBe(true);
    if (plain.ok && sorted.ok) expect(sorted.formatted).not.toBe(plain.formatted);
  });
});

describe("sampleVitestOutput", () => {
  it("is parsed by the router's test summariser with exactly the requested counts", () => {
    const text = sampleVitestOutput(createRng(1), { files: 7, tests: 44, failed: 3 });
    const summary = summarizeTestOutput(text);
    expect(summary).toMatchObject({ framework: "vitest", total: 44, passed: 41, failed: 3, skipped: 0 });
    expect(summary?.failures).toHaveLength(3);
  });

  it("reports an all-green run when nothing failed", () => {
    const summary = summarizeTestOutput(sampleVitestOutput(createRng(2), { files: 5, tests: 30, failed: 0 }));
    expect(summary).toMatchObject({ total: 30, passed: 30, failed: 0 });
    expect(summary?.failures).toEqual([]);
  });
});
