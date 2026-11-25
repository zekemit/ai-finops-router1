import { describe, expect, it } from "vitest";
import { lintFiles } from "../src/scripts/lint";
import type { LintIssue } from "../src/scripts/lint";

const lint = (content: string, path = "a.ts", options?: { maxLineLength?: number }): LintIssue[] =>
  lintFiles([{ path, content }], options);
const rules = (issues: readonly LintIssue[]): string[] => issues.map((i) => `${i.rule}@${i.line}:${i.column}`);

describe("lintFiles", () => {
  it("returns nothing for a clean file", () => {
    expect(lint("const a = 1;\nexport { a };\n")).toEqual([]);
  });

  it("flags trailing whitespace at the first trailing space", () => {
    expect(rules(lint("const a = 1;  \n"))).toEqual(["no-trailing-spaces@1:13"]);
  });

  it("does not treat the carriage return of CRLF line endings as trailing whitespace", () => {
    expect(lint("const a = 1;\r\nconst b = 2;\r\n")).toEqual([]);
  });

  it("flags indentation that mixes tabs and spaces", () => {
    expect(rules(lint("function f() {\n\t  return 1;\n}\n"))).toEqual(["no-mixed-indent@2:1"]);
  });

  it("does not flag the ' *' continuation line of a tab-indented block comment as mixed indentation", () => {
    expect(lint("\t/**\n\t * Docs.\n\t */\n\tfoo();\n")).toEqual([]);
  });

  it("flags lines over the max length (default 120) at the first excess column", () => {
    expect(lint(`${"x".repeat(120)}\n`)).toEqual([]);
    const [issue] = lint(`${"x".repeat(121)}\n`);
    expect(issue).toMatchObject({ rule: "max-len", line: 1, column: 121, severity: "warning" });
    expect(issue?.message).toContain("121 characters (max 120)");
  });

  it("honours a custom max length", () => {
    expect(rules(lint(`${"x".repeat(81)}\n`, "a.ts", { maxLineLength: 80 }))).toEqual(["max-len@1:81"]);
  });

  it("flags a missing final newline on the last line, but not for empty files", () => {
    expect(rules(lint("a\nb"))).toEqual(["eol-last@2:2"]);
    expect(lint("")).toEqual([]);
    expect(lint("a\n")).toEqual([]);
  });

  it("flags a debugger statement in JavaScript/TypeScript only, and not in comments or strings", () => {
    expect(rules(lint("function f() {\n  debugger;\n}\n"))).toEqual(["no-debugger@2:3"]);
    expect(lint("x = 1\n  debugger\n", "a.py")).toEqual([]);
    expect(lint('// debugger;\nconst s = "debugger";\n')).toEqual([]);
  });

  it("flags merge-conflict markers as errors", () => {
    const issues = lint("<<<<<<< HEAD\na\n=======\nb\n>>>>>>> branch\n", "a.txt");
    expect(rules(issues)).toEqual(["no-conflict-markers@1:1", "no-conflict-markers@3:1", "no-conflict-markers@5:1"]);
    expect(issues.every((i) => i.severity === "error")).toBe(true);
  });

  it("orders issues by path, then line, then column, across several files", () => {
    const issues = lintFiles([
      { path: "b.ts", content: "x  \n" },
      { path: "a.ts", content: "y\t \n  z  \n" },
    ]);
    expect(issues.map((i) => `${i.path}:${i.line}`)).toEqual(["a.ts:1", "a.ts:2", "b.ts:1"]);
  });

  it("reports each issue at most once per rule per line", () => {
    expect(lint("a  \t \n").filter((i) => i.rule === "no-trailing-spaces")).toHaveLength(1);
  });
});
