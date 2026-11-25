import { describe, expect, it } from "vitest";
import { grepFiles } from "../src/scripts/grep";
import { compilePattern, isSafePattern } from "../src/scripts/regex";

function compile(pattern: string, opts: { regex?: boolean; caseInsensitive?: boolean } = {}): RegExp {
  const result = compilePattern(pattern, { regex: opts.regex ?? false, caseInsensitive: opts.caseInsensitive ?? false });
  if (!result.ok) throw new Error(`test setup: ${result.reason}`);
  return result.regex;
}

const files = [
  { path: "src/a.ts", content: "export function parseUsage() {}\nconst x = parseUsage();\n// nothing\n" },
  { path: "src/b.ts", content: "import { parseUsage } from './a';\r\nexport const PARSEUSAGE = 1;\r\n" },
];

describe("isSafePattern", () => {
  it.each([["(a+)+$"], ["(x+x+)+y"], ["(a*)*"], ["(.*a){12}"], ["(a|b*)*c"]])("rejects the catastrophic-backtracking shape %s", (p) => {
    expect(isSafePattern(p)).toBe(false);
  });

  it.each([["a+b+"], ["^export \\w+"], ["(foo|bar)+"], ["\\bparseUsage\\("], ["[a-z]{2,5}\\d*"]])("accepts %s", (p) => {
    expect(isSafePattern(p)).toBe(true);
  });

  it("rejects over-long patterns", () => {
    expect(isSafePattern("a".repeat(257))).toBe(false);
    expect(isSafePattern("a".repeat(256))).toBe(true);
  });
});

describe("compilePattern", () => {
  it("escapes regex metacharacters in literal mode", () => {
    const regex = compile("a.b");
    expect(regex.test("a.b")).toBe(true);
    expect(regex.test("axb")).toBe(false);
  });

  it("treats the pattern as a regular expression in regex mode", () => {
    expect(compile("^export (function|const) \\w+", { regex: true }).test("export const X")).toBe(true);
  });

  it("applies case-insensitivity", () => {
    expect(compile("abc", { caseInsensitive: true }).test("xABCx")).toBe(true);
    expect(compile("abc").test("xABCx")).toBe(false);
  });

  it("reports an invalid regular expression instead of throwing", () => {
    const result = compilePattern("(unclosed", { regex: true, caseInsensitive: false });
    expect(result.ok).toBe(false);
  });

  it("refuses an unsafe regular expression but allows the same text as a literal", () => {
    expect(compilePattern("(a+)+$", { regex: true, caseInsensitive: false }).ok).toBe(false);
    expect(compilePattern("(a+)+$", { regex: false, caseInsensitive: false }).ok).toBe(true);
  });

  it("refuses an empty pattern", () => {
    expect(compilePattern("", { regex: false, caseInsensitive: false }).ok).toBe(false);
  });
});

describe("grepFiles", () => {
  it("returns path, 1-based line, 1-based column of the first match, and the line text", () => {
    const result = grepFiles(files, compile("parseUsage"));
    expect(result.matches[0]).toEqual({ path: "src/a.ts", line: 1, column: 17, text: "export function parseUsage() {}" });
    expect(result.matches[1]).toEqual({ path: "src/a.ts", line: 2, column: 11, text: "const x = parseUsage();" });
    expect(result.matches[2]).toMatchObject({ path: "src/b.ts", line: 1, text: "import { parseUsage } from './a';" });
  });

  it("counts a line once however many times it matches, and is case-sensitive by default", () => {
    const result = grepFiles([{ path: "f", content: "aaa\nbab\n" }], compile("a"));
    expect(result.totalMatches).toBe(2);
    expect(grepFiles(files, compile("parseusage")).totalMatches).toBe(0);
    expect(grepFiles(files, compile("parseusage", { caseInsensitive: true })).totalMatches).toBe(4);
  });

  it("summarises how many files matched", () => {
    expect(grepFiles(files, compile("parseUsage")).filesWithMatches).toBe(2);
    expect(grepFiles(files, compile("nothing")).filesWithMatches).toBe(1);
  });

  it("handles CRLF files without leaking carriage returns into the output", () => {
    expect(grepFiles(files, compile("PARSEUSAGE")).matches[0]?.text).toBe("export const PARSEUSAGE = 1;");
  });

  it("caps returned matches but still reports the true total", () => {
    const many = [{ path: "f", content: Array.from({ length: 50 }, () => "hit").join("\n") }];
    const result = grepFiles(many, compile("hit"), { maxMatches: 10 });
    expect(result.matches).toHaveLength(10);
    expect(result.totalMatches).toBe(50);
    expect(result.truncated).toBe(true);
    expect(grepFiles(many, compile("hit")).truncated).toBe(false);
  });

  it("truncates very long matching lines in the output", () => {
    const result = grepFiles([{ path: "f", content: `hit ${"x".repeat(500)}\n` }], compile("hit"));
    expect(result.matches[0]?.text.length).toBeLessThanOrEqual(200);
  });

  it("returns an empty, non-truncated result when nothing matches", () => {
    expect(grepFiles(files, compile("zzz"))).toEqual({ matches: [], totalMatches: 0, filesWithMatches: 0, truncated: false });
  });
});
