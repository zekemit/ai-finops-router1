import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectFramework, summarizeTestOutput } from "../src/scripts/test-summary";

// Fixtures are REAL output captured from vitest 5.1, jest 29, pytest 9.1 and go 1.x
// running the same sample suite: 6 tests = 3 passed, 2 failed, 1 skipped (vitest-pass: 2 passed).
const fixture = (name: string): string => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

describe("detectFramework", () => {
  it("recognises each framework from its real output", () => {
    expect(detectFramework(fixture("vitest-fail.txt"))).toBe("vitest");
    expect(detectFramework(fixture("vitest-pass.txt"))).toBe("vitest");
    expect(detectFramework(fixture("jest-fail.txt"))).toBe("jest");
    expect(detectFramework(fixture("pytest-fail.txt"))).toBe("pytest");
    expect(detectFramework(fixture("go-fail.txt"))).toBe("go");
  });

  it("returns undefined for text that is not test output", () => {
    expect(detectFramework("hello world")).toBeUndefined();
    expect(detectFramework("")).toBeUndefined();
    expect(detectFramework("Tests are important, and 5 passed my review.")).toBeUndefined();
  });
});

describe("summarizeTestOutput — real captured output", () => {
  it("vitest with failures", () => {
    const s = summarizeTestOutput(fixture("vitest-fail.txt"));
    expect(s).toMatchObject({ framework: "vitest", total: 6, passed: 3, failed: 2, skipped: 1 });
    expect(s?.failures).toEqual([
      { name: "sample.test.ts > math > subtracts wrongly", message: "AssertionError: expected 2 to be 3 // Object.is equality" },
      { name: "sample.test.ts > strings > concats wrongly", message: "AssertionError: expected 'ab' to be 'abc' // Object.is equality" },
    ]);
  });

  it("vitest all passing", () => {
    expect(summarizeTestOutput(fixture("vitest-pass.txt"))).toEqual({ framework: "vitest", total: 2, passed: 2, failed: 0, skipped: 0, failures: [] });
  });

  it("jest with failures", () => {
    const s = summarizeTestOutput(fixture("jest-fail.txt"));
    expect(s).toMatchObject({ framework: "jest", total: 6, passed: 3, failed: 2, skipped: 1 });
    expect(s?.failures).toEqual([
      { name: "math › subtracts wrongly", message: "expect(received).toBe(expected) // Object.is equality" },
      { name: "strings › concats wrongly", message: "expect(received).toBe(expected) // Object.is equality" },
    ]);
  });

  it("pytest with failures, keeping only the first line of a multi-line failure message", () => {
    const s = summarizeTestOutput(fixture("pytest-fail.txt"));
    expect(s).toMatchObject({ framework: "pytest", total: 6, passed: 3, failed: 2, skipped: 1 });
    expect(s?.failures).toEqual([
      { name: "test_sample.py::test_subtracts_wrongly", message: "assert (5 - 3) == 3" },
      { name: "test_sample.py::test_concat_wrongly", message: "AssertionError: assert 'ab' == 'abc'" },
    ]);
  });

  it("go test -v, recovering the failure message from the lines before the FAIL marker", () => {
    const s = summarizeTestOutput(fixture("go-fail.txt"));
    expect(s).toMatchObject({ framework: "go", total: 5, passed: 3, failed: 1, skipped: 1 });
    expect(s?.failures).toEqual([{ name: "TestSubtractsWrongly", message: "want 3 got 2" }]);
  });
});

describe("summarizeTestOutput — other shapes", () => {
  it("reads vitest's multi-file summary used by this very repo", () => {
    const text = " Test Files  11 passed (11)\n      Tests  158 passed (158)\n   Duration  609ms\n";
    expect(summarizeTestOutput(text)).toMatchObject({ framework: "vitest", total: 158, passed: 158, failed: 0 });
  });

  it("reads vitest's mixed-status line", () => {
    const text = " Test Files  1 failed | 7 passed (8)\n      Tests  1 failed | 125 passed (126)\n";
    expect(summarizeTestOutput(text)).toMatchObject({ total: 126, passed: 125, failed: 1, skipped: 0 });
  });

  it("reads a pytest run with errors and no failures list", () => {
    const text = "============================= test session starts ==============================\n=================== 1 error, 4 passed in 0.12s ====================\n";
    expect(summarizeTestOutput(text)).toMatchObject({ framework: "pytest", total: 5, passed: 4, failed: 1 });
  });

  it("de-duplicates a failure that vitest prints twice", () => {
    const text = [" FAIL  a.test.ts > t", "AssertionError: x", "", " FAIL  a.test.ts > t", "AssertionError: x", " Test Files  1 failed (1)", "      Tests  1 failed (1)"].join("\n");
    expect(summarizeTestOutput(text)?.failures).toHaveLength(1);
  });

  it("returns undefined rather than guessing when the framework is not recognised", () => {
    expect(summarizeTestOutput("ran some stuff; 3 passed 1 failed")).toBeUndefined();
  });
});
