import { summarizeTestOutput } from "../scripts/test-summary";
import type { TestSummary } from "../scripts/test-summary";
import type { OffloadRule } from "../types";
import { MAX_INPUT_CHARS, decline, declineReasoning, fencedBlock, hasOperation, reasoningVerb } from "./shared";

const OPERATIONS = ["test.summary"] as const;
const NOT_TESTS = "not a test-result summarisation request";
const MENTIONS_TESTS = /\b(tests?|failures?|failing|failed|jest|vitest|pytest|go test)\b/i;
const INTENT = /\b(summari[sz]e|summary|parse|extract|list|show|report|count|how many|results?)\b/i;
const MAX_FAILURES_SHOWN = 20;

function render(s: TestSummary): string {
  const lines = [`Tests (${s.framework}): ${s.total} total — ${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped`];
  if (s.failed === 0) lines.push(s.skipped === 0 ? "All tests passed." : "No failures.");
  if (s.failures.length > 0) {
    lines.push("Failures:");
    s.failures.slice(0, MAX_FAILURES_SHOWN).forEach((f, i) => {
      lines.push(`  ${i + 1}. ${f.name}${f.message === undefined ? "" : ` — ${f.message}`}`);
    });
    if (s.failures.length > MAX_FAILURES_SHOWN) lines.push(`  … and ${s.failures.length - MAX_FAILURES_SHOWN} more`);
  }
  return lines.join("\n");
}

export const testSummaryRule: OffloadRule = {
  id: "test-summary",
  description: "Summarises vitest / jest / pytest / go test output into counts and a failure list",
  operations: OPERATIONS,
  evaluate(task) {
    if (!hasOperation(task, OPERATIONS)) {
      if (!MENTIONS_TESTS.test(task.prompt)) return decline(NOT_TESTS);
      const verb = reasoningVerb(task.prompt);
      if (verb !== undefined) return declineReasoning(verb);
      if (!INTENT.test(task.prompt)) return decline(NOT_TESTS);
    }

    const text = task.inputs?.text ?? fencedBlock(task.prompt);
    if (text === undefined || text.trim() === "") return decline("no test output attached (inputs.text or a fenced code block)");
    if (text.length > MAX_INPUT_CHARS) return decline("input is too large for an inline script");

    const summary = summarizeTestOutput(text);
    if (summary === undefined) return decline("test output format not recognised (supported: vitest, jest, pytest, go test -v)");

    return { matched: true, run: () => ({ ruleId: "test-summary", output: render(summary), data: summary }) };
  },
};
