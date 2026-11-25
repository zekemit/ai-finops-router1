import { describe, expect, it } from "vitest";
import { RepoFactsError, loadRepoFacts, parseRepoFacts } from "../src/lib/repo-facts";

const pkg = (name: string, total: number, passed: number, files: number) => ({
  [name]: { status: passed === total ? "passed" : "failed", phase: null, total, passed, failed: total - passed, skipped: 0, files: Array.from({ length: files }, (_, i) => ({ file: `t${i}.test.ts`, status: "passed", total: 1, passed: 1, failed: 0, skipped: 0 })), failures: [] },
});
const sample = {
  generatedBy: "npm run record-tests",
  generatedAt: "2026-11-25T15:22:24.601Z",
  summary: { total: 30, passed: 29, failed: 1, skipped: 0 },
  packages: { ...pkg("@ai-finops/interceptor", 10, 10, 2), ...pkg("@ai-finops/router", 20, 19, 3) },
};

describe("parseRepoFacts", () => {
  it("reads totals, files and per-package results from tests.json", () => {
    expect(parseRepoFacts(sample)).toEqual({
      generatedAt: "2026-11-25T15:22:24.601Z",
      total: 30,
      passed: 29,
      failed: 1,
      files: 5,
      packages: [
        { name: "@ai-finops/interceptor", total: 10, passed: 10, failed: 0 },
        { name: "@ai-finops/router", total: 20, passed: 19, failed: 1 },
      ],
    });
  });

  it.each([
    ["not an object", "nope"],
    ["no summary", { packages: {} }],
    ["a non-numeric total", { ...sample, summary: { ...sample.summary, total: "30" } }],
    ["a negative count", { ...sample, summary: { ...sample.summary, passed: -1 } }],
    ["passed greater than total", { ...sample, summary: { ...sample.summary, passed: 31 } }],
    ["no packages", { summary: sample.summary }],
    ["a package without counts", { ...sample, packages: { bad: { files: [] } } }],
  ])("rejects %s with a RepoFactsError, never a half-parsed object", (_label, input) => {
    expect(() => parseRepoFacts(input)).toThrow(RepoFactsError);
  });
});

describe("loadRepoFacts", () => {
  it("reads this repository's real tests.json and adds the live model and rule counts", async () => {
    const facts = await loadRepoFacts();
    expect(facts.total).toBeGreaterThanOrEqual(419);
    expect(facts.failed).toBe(0);
    expect(facts.passed).toBe(facts.total);
    expect(facts.models).toBe(13);
    expect(facts.rules).toBe(4);
    expect(facts.packages.map((p) => p.name)).toEqual(expect.arrayContaining(["@ai-finops/interceptor", "@ai-finops/router", "@ai-finops/dashboard"]));
  });
});
