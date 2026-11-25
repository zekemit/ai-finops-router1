/**
 * Summarise raw test-runner output (vitest, jest, pytest, `go test -v`) into counts and a failure list.
 * Formats were verified against real captured output of each runner. Anything not recognised yields
 * `undefined` so the router falls back to the LLM instead of guessing.
 */

export type TestFramework = "vitest" | "jest" | "pytest" | "go";

export interface TestFailure {
  readonly name: string;
  readonly message?: string;
}

export interface TestSummary {
  readonly framework: TestFramework;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly failures: readonly TestFailure[];
}

const JEST_TESTS_LINE = /^\s*Tests:\s+(.*?)\s*(\d+)\s+total\s*$/m;
const VITEST_TESTS_LINE = /^\s*Tests\s+(\d[^()\n]*?)\s*\((\d+)\)\s*$/m;
const PYTEST_HEADER = /^=+ test session starts =+$/m;
const PYTEST_SUMMARY = /^=+\s*(.*?)\s+in\s+[\d.]+s(?:\s+\([^)]*\))?\s*=+\s*$/m;
const GO_MARKER = /^(?:=== RUN|\s*--- (?:PASS|FAIL|SKIP):)/m;

export function detectFramework(text: string): TestFramework | undefined {
  if (JEST_TESTS_LINE.test(text)) return "jest";
  if (VITEST_TESTS_LINE.test(text)) return "vitest";
  if (PYTEST_HEADER.test(text) || PYTEST_SUMMARY.test(text)) return "pytest";
  if (GO_MARKER.test(text)) return "go";
  return undefined;
}

function counts(fragment: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [, n, label] of fragment.matchAll(/(\d+)\s+([a-z]+)/g)) {
    if (n !== undefined && label !== undefined) out.set(label, (out.get(label) ?? 0) + Number(n));
  }
  return out;
}

const pick = (map: Map<string, number>, ...labels: string[]): number => labels.reduce((sum, l) => sum + (map.get(l) ?? 0), 0);

function failure(name: string, message: string | undefined): TestFailure {
  const trimmed = message?.trim();
  return trimmed === undefined || trimmed === "" ? { name } : { name, message: trimmed };
}

/** First non-blank line after index `i`. */
function lineAfter(lines: readonly string[], i: number): string | undefined {
  for (let j = i + 1; j < lines.length; j += 1) {
    const candidate = lines[j];
    if (candidate !== undefined && candidate.trim() !== "") return candidate;
  }
  return undefined;
}

function uniqueByName(failures: readonly TestFailure[]): TestFailure[] {
  const seen = new Set<string>();
  return failures.filter((f) => !seen.has(f.name) && seen.add(f.name));
}

function summarizeVitest(text: string): TestSummary | undefined {
  const line = VITEST_TESTS_LINE.exec(text);
  if (line?.[1] === undefined || line[2] === undefined) return undefined;
  const c = counts(line[1]);
  const lines = text.split(/\r?\n/);
  const failures: TestFailure[] = [];
  lines.forEach((l, i) => {
    const m = /^\s*FAIL\s+(\S.*?)\s*$/.exec(l);
    if (m?.[1] !== undefined) failures.push(failure(m[1], lineAfter(lines, i)));
  });
  return { framework: "vitest", total: Number(line[2]), passed: pick(c, "passed"), failed: pick(c, "failed"), skipped: pick(c, "skipped", "todo"), failures: uniqueByName(failures) };
}

function summarizeJest(text: string): TestSummary | undefined {
  const line = JEST_TESTS_LINE.exec(text);
  if (line?.[1] === undefined || line[2] === undefined) return undefined;
  const c = counts(line[1]);
  const lines = text.split(/\r?\n/);
  const failures: TestFailure[] = [];
  lines.forEach((l, i) => {
    const m = /^\s*●\s+(\S.*?)\s*$/.exec(l);
    if (m?.[1] !== undefined && !m[1].startsWith("Console")) failures.push(failure(m[1], lineAfter(lines, i)));
  });
  return { framework: "jest", total: Number(line[2]), passed: pick(c, "passed"), failed: pick(c, "failed"), skipped: pick(c, "skipped", "todo"), failures: uniqueByName(failures) };
}

function summarizePytest(text: string): TestSummary | undefined {
  const line = PYTEST_SUMMARY.exec(text);
  if (line?.[1] === undefined) return undefined;
  // pytest reports collection/setup problems as "errors"; for a go/no-go summary they count as failures.
  const c = counts(line[1].replace(/(\d+)\s+errors?\b/g, "$1 failed"));
  const failed = pick(c, "failed");
  const passed = pick(c, "passed", "xpassed");
  const skipped = pick(c, "skipped", "xfailed");
  const failures: TestFailure[] = [];
  for (const m of text.matchAll(/^(?:FAILED|ERROR)\s+(\S+)(?:\s+-\s+(.*))?$/gm)) {
    if (m[1] !== undefined) failures.push(failure(m[1], m[2]));
  }
  return { framework: "pytest", total: failed + passed + skipped, passed, failed, skipped, failures: uniqueByName(failures) };
}

function summarizeGo(text: string): TestSummary | undefined {
  const lines = text.split(/\r?\n/);
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures: TestFailure[] = [];
  lines.forEach((l, i) => {
    const m = /^\s*--- (PASS|FAIL|SKIP): (\S+)/.exec(l);
    if (m?.[1] === undefined || m[2] === undefined) return;
    if (m[1] === "PASS") passed += 1;
    else if (m[1] === "SKIP") skipped += 1;
    else {
      failed += 1;
      let message: string | undefined;
      for (let j = i - 1; j >= 0 && !(lines[j] ?? "").startsWith("=== RUN"); j -= 1) {
        const found = /^\s*\S+\.go:\d+:\s*(.*)$/.exec(lines[j] ?? "");
        if (found?.[1] !== undefined) message = found[1]; // keep scanning up: the earliest line is the first report
      }
      failures.push(failure(m[2], message));
    }
  });
  if (passed + failed + skipped === 0) return undefined;
  return { framework: "go", total: passed + failed + skipped, passed, failed, skipped, failures: uniqueByName(failures) };
}

export function summarizeTestOutput(text: string): TestSummary | undefined {
  switch (detectFramework(text)) {
    case "vitest":
      return summarizeVitest(text);
    case "jest":
      return summarizeJest(text);
    case "pytest":
      return summarizePytest(text);
    case "go":
      return summarizeGo(text);
    default:
      return undefined;
  }
}
