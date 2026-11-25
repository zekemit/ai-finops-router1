import { describe, expect, it } from "vitest";
import { grepSearchRule } from "../src/rules/grep-search";
import { jsonFormatRule } from "../src/rules/json-format";
import { lintCheckRule } from "../src/rules/lint-check";
import { testSummaryRule } from "../src/rules/test-summary";
import type { OffloadRule, ScriptOutcome } from "../src/types";
import { fixture, makeTask } from "./helpers";

function runRule(rule: OffloadRule, task: ReturnType<typeof makeTask>): ScriptOutcome {
  const verdict = rule.evaluate(task);
  if (!verdict.matched) throw new Error(`expected ${rule.id} to match, but: ${verdict.reason}`);
  return verdict.run();
}
function rejection(rule: OffloadRule, task: ReturnType<typeof makeTask>): string {
  const verdict = rule.evaluate(task);
  if (verdict.matched) throw new Error(`expected ${rule.id} to reject`);
  return verdict.reason;
}

describe("json-format rule", () => {
  it("formats an attached document and says it is valid", () => {
    const out = runRule(jsonFormatRule, makeTask({ prompt: "Format this JSON", inputs: { text: '{"b":1}' } }));
    expect(out.ruleId).toBe("json-format");
    expect(out.output).toBe('Valid JSON.\n\n{\n  "b": 1\n}');
    expect(out.data).toEqual({ valid: true, schemaIssues: 0 });
  });

  it("matches on an explicit operation even when the prompt says nothing about JSON", () => {
    const out = runRule(jsonFormatRule, makeTask({ prompt: "do it", operation: "json.format", inputs: { text: "[1]" } }));
    expect(out.output).toContain("Valid JSON.");
  });

  it("reads the document from a fenced code block in the prompt", () => {
    const prompt = 'Please prettify this JSON:\n```json\n{"a":[1,2]}\n```';
    expect(runRule(jsonFormatRule, makeTask({ prompt })).output).toContain('"a": [\n    1,\n    2\n  ]');
  });

  it("answers an invalid document deterministically, with the exact position", () => {
    const out = runRule(jsonFormatRule, makeTask({ prompt: "Validate this JSON", inputs: { text: '{\n  "a": 1,\n}' } }));
    expect(out.output).toBe('Invalid JSON: Unexpected character "}"; expected a property name at line 3, column 1');
    expect(out.data).toEqual({ valid: false, schemaIssues: 0 });
  });

  it("minifies and sorts keys when asked", () => {
    const minified = runRule(jsonFormatRule, makeTask({ prompt: "Minify this JSON", inputs: { text: '{ "b": 1, "a": 2 }' } }));
    expect(minified.output).toBe('Valid JSON.\n\n{"b":1,"a":2}');
    const sorted = runRule(jsonFormatRule, makeTask({ prompt: "Format this JSON and sort the keys", inputs: { text: '{"b":1,"a":2}' } }));
    expect(sorted.output).toContain('{\n  "a": 2,\n  "b": 1\n}');
  });

  it("validates against a schema and lists each issue with its path, without echoing the document for a validate-only request", () => {
    const schema = { type: "object", required: ["name", "age"], properties: { age: { type: "integer" } } };
    const out = runRule(jsonFormatRule, makeTask({ prompt: "Validate this JSON against the schema", inputs: { text: '{"age":"x"}', schema } }));
    expect(out.output).toBe(
      'Valid JSON.\n\nSchema validation failed (2 issue(s)):\n  / missing required property "name"\n  /age expected integer, got string',
    );
    expect(out.data).toEqual({ valid: true, schemaIssues: 2 });
  });

  it("reports a passing schema check", () => {
    const out = runRule(jsonFormatRule, makeTask({ prompt: "Validate this JSON", inputs: { text: '{"a":1}', schema: { type: "object" } } }));
    expect(out.output).toBe("Valid JSON.\n\nSchema validation passed.");
  });

  it("declines requests that need judgement, naming the verb that disqualified it", () => {
    expect(rejection(jsonFormatRule, makeTask({ prompt: "Fix this broken JSON", inputs: { text: "{a:1}" } }))).toContain('"fix"');
    expect(rejection(jsonFormatRule, makeTask({ prompt: "Explain this JSON", inputs: { text: "{}" } }))).toContain('"explain"');
  });

  it("declines when the schema uses keywords the validator cannot evaluate", () => {
    const reason = rejection(jsonFormatRule, makeTask({ prompt: "Validate this JSON", inputs: { text: "{}", schema: { $ref: "#/defs/x" } } }));
    expect(reason).toContain("$ref");
  });

  it("declines when no document is attached or the request is not about JSON", () => {
    expect(rejection(jsonFormatRule, makeTask({ prompt: "Format this JSON" }))).toContain("no JSON document");
    expect(rejection(jsonFormatRule, makeTask({ prompt: "Write a haiku about caching" }))).toContain("not a JSON");
  });

  it("declines oversized input rather than risking the agent loop", () => {
    expect(rejection(jsonFormatRule, makeTask({ prompt: "Format this JSON", inputs: { text: "[".repeat(2_000_001) } }))).toContain("too large");
  });
});

describe("test-summary rule", () => {
  it("summarises real vitest output with counts and each failure", () => {
    const out = runRule(testSummaryRule, makeTask({ prompt: "Summarize the test output", inputs: { text: fixture("vitest-fail.txt") } }));
    expect(out.output).toContain("Tests (vitest): 6 total — 3 passed, 2 failed, 1 skipped");
    expect(out.output).toContain("1. sample.test.ts > math > subtracts wrongly — AssertionError: expected 2 to be 3 // Object.is equality");
    expect(out.output).toContain("2. sample.test.ts > strings > concats wrongly");
    expect(out.data).toMatchObject({ framework: "vitest", total: 6, failed: 2 });
  });

  it("says so plainly when everything passed", () => {
    const out = runRule(testSummaryRule, makeTask({ prompt: "Summarize the test output", inputs: { text: fixture("vitest-pass.txt") } }));
    expect(out.output).toBe("Tests (vitest): 2 total — 2 passed, 0 failed, 0 skipped\nAll tests passed.");
  });

  it("works for the other runners", () => {
    for (const [file, framework] of [["jest-fail.txt", "jest"], ["pytest-fail.txt", "pytest"], ["go-fail.txt", "go"]] as const) {
      const out = runRule(testSummaryRule, makeTask({ prompt: "List the failing tests", inputs: { text: fixture(file) } }));
      expect(out.output).toContain(`Tests (${framework}):`);
    }
  });

  it("matches on an explicit operation", () => {
    expect(runRule(testSummaryRule, makeTask({ prompt: "?", operation: "test.summary", inputs: { text: fixture("vitest-pass.txt") } })).ruleId).toBe("test-summary");
  });

  it("caps a long failure list and says how many were left out", () => {
    const text = [...Array.from({ length: 25 }, (_, i) => ` FAIL  t.test.ts > case ${i}\nError: boom\n`), " Test Files  1 failed (1)", "      Tests  25 failed (25)"].join("\n");
    const out = runRule(testSummaryRule, makeTask({ prompt: "Summarize the test output", inputs: { text } }));
    expect(out.output).toContain("20. t.test.ts > case 19");
    expect(out.output).not.toContain("21.");
    expect(out.output).toContain("… and 5 more");
  });

  it("declines to explain why tests failed, which needs reasoning", () => {
    expect(rejection(testSummaryRule, makeTask({ prompt: "Why did the tests fail? Summarize the test output", inputs: { text: fixture("vitest-fail.txt") } }))).toContain('"why"');
  });

  it("declines output from a runner it does not recognise", () => {
    expect(rejection(testSummaryRule, makeTask({ prompt: "Summarize the test output", inputs: { text: "3 passed, 1 failed (I think)" } }))).toContain("not recognised");
  });

  it("declines unrelated requests and missing output", () => {
    expect(rejection(testSummaryRule, makeTask({ prompt: "Write a haiku" }))).toContain("not a test-result");
    expect(rejection(testSummaryRule, makeTask({ prompt: "Summarize the test output" }))).toContain("no test output");
  });
});

describe("lint-check rule", () => {
  const files = [
    { path: "a.ts", content: "const a = 1;  \n" },
    { path: "b.ts", content: "export {};\n" },
  ];

  it("lists issues with path:line:column, severity and rule", () => {
    const out = runRule(lintCheckRule, makeTask({ prompt: "Run lint on these files and list the issues", inputs: { files } }));
    expect(out.output).toBe(
      "Lint: 1 issue(s) in 1 of 2 file(s) (0 error(s), 1 warning(s))\na.ts:1:13 warning no-trailing-spaces trailing whitespace",
    );
    expect(out.data).toEqual({ issues: 1, errors: 0, warnings: 1 });
  });

  it("reports a clean bill of health", () => {
    const out = runRule(lintCheckRule, makeTask({ prompt: "Lint these files", inputs: { files: [files[1] ?? { path: "b.ts", content: "" }] } }));
    expect(out.output).toBe("Lint: no issues found in 1 file(s)");
  });

  it("honours a max line length from the task", () => {
    const out = runRule(lintCheckRule, makeTask({ prompt: "Lint these files", inputs: { files: [{ path: "a.ts", content: `${"x".repeat(41)}\n` }], maxLineLength: 40 } }));
    expect(out.output).toContain("max-len");
  });

  it("matches on an explicit operation", () => {
    expect(runRule(lintCheckRule, makeTask({ prompt: "go", operation: "lint", inputs: { files } })).ruleId).toBe("lint-check");
  });

  it("caps a long issue list", () => {
    const content = `${Array.from({ length: 60 }, () => "x  ").join("\n")}\n`;
    const out = runRule(lintCheckRule, makeTask({ prompt: "Lint these files", inputs: { files: [{ path: "a.ts", content }] } }));
    expect(out.output).toContain("… and 10 more");
    expect(out.data).toMatchObject({ issues: 60 });
  });

  it("declines to fix anything, which needs code edits", () => {
    expect(rejection(lintCheckRule, makeTask({ prompt: "Fix the lint errors in these files", inputs: { files } }))).toContain('"fix"');
  });

  it("declines when no files are attached or the request is unrelated", () => {
    expect(rejection(lintCheckRule, makeTask({ prompt: "Lint these files" }))).toContain("no files");
    expect(rejection(lintCheckRule, makeTask({ prompt: "Write a haiku", inputs: { files } }))).toContain("not a lint");
  });
});

describe("grep-search rule", () => {
  const files = [
    { path: "src/a.ts", content: "export function parseUsage() {}\nconst x = parseUsage();\n" },
    { path: "src/b.ts", content: "import { parseUsage } from './a';\n// PARSEUSAGE\n" },
  ];

  it("finds a quoted token across files and prints grep-style lines", () => {
    const out = runRule(grepSearchRule, makeTask({ prompt: "Find all usages of `parseUsage` in the codebase", inputs: { files } }));
    expect(out.output).toBe(
      [
        "Found 3 match(es) in 2 file(s):",
        "src/a.ts:1:17: export function parseUsage() {}",
        "src/a.ts:2:11: const x = parseUsage();",
        "src/b.ts:1:10: import { parseUsage } from './a';",
      ].join("\n"),
    );
    expect(out.data).toEqual({ totalMatches: 3, filesWithMatches: 2, truncated: false });
  });

  it("prefers an explicit pattern, supports regex mode and case-insensitive search", () => {
    const regex = runRule(grepSearchRule, makeTask({ prompt: "grep the files", inputs: { files, pattern: "^export \\w+", regex: true } }));
    expect(regex.data).toMatchObject({ totalMatches: 1 });
    const loose = runRule(grepSearchRule, makeTask({ prompt: "Search for `parseusage`, case-insensitive", inputs: { files } }));
    expect(loose.data).toMatchObject({ totalMatches: 4 });
  });

  it("says when nothing matched", () => {
    const out = runRule(grepSearchRule, makeTask({ prompt: "Find all usages of `zzz`", inputs: { files } }));
    expect(out.output).toBe('No matches for "zzz" in 2 file(s).');
  });

  it("matches on an explicit operation", () => {
    expect(runRule(grepSearchRule, makeTask({ prompt: "go", operation: "grep", inputs: { files, pattern: "x" } })).ruleId).toBe("grep-search");
  });

  it("truncates a long match list and states the true total", () => {
    const big = [{ path: "f.ts", content: Array.from({ length: 80 }, () => "hit").join("\n") }];
    const out = runRule(grepSearchRule, makeTask({ prompt: "Find all occurrences of `hit`", inputs: { files: big } }));
    expect(out.output).toContain("Found 80 match(es) in 1 file(s):");
    expect(out.output).toContain("(showing first 50 of 80 matches)");
    expect(out.data).toMatchObject({ truncated: true });
  });

  it("declines a regular expression that could backtrack catastrophically", () => {
    expect(rejection(grepSearchRule, makeTask({ prompt: "grep the files", inputs: { files, pattern: "(a+)+$", regex: true } }))).toContain("backtracking");
  });

  it("declines requests that ask for explanation as well as search", () => {
    expect(rejection(grepSearchRule, makeTask({ prompt: "Find all usages of `parseUsage` and explain how they work", inputs: { files } }))).toContain('"explain"');
  });

  it("declines when it cannot tell what to search for, has no files, or is unrelated", () => {
    expect(rejection(grepSearchRule, makeTask({ prompt: "Find all usages please", inputs: { files } }))).toContain("no search pattern");
    expect(rejection(grepSearchRule, makeTask({ prompt: "Find all usages of `x`" }))).toContain("no files");
    expect(rejection(grepSearchRule, makeTask({ prompt: "Write a haiku", inputs: { files } }))).toContain("not a search");
  });

  it("declines oversized input", () => {
    const huge = [{ path: "f", content: "x".repeat(2_000_001) }];
    expect(rejection(grepSearchRule, makeTask({ prompt: "Find all usages of `x`", inputs: { files: huge } }))).toContain("too large");
  });
});
