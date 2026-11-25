import { lintFiles } from "../scripts/lint";
import type { OffloadRule } from "../types";
import { MAX_INPUT_CHARS, decline, declineReasoning, hasOperation, reasoningVerb, totalChars } from "./shared";

const OPERATIONS = ["lint"] as const;
const MENTIONS_LINT = /\b(lint(?:er|ing)?|eslint|code style|style check|trailing whitespace|formatting issues)\b/i;
const MAX_ISSUES_SHOWN = 50;

export const lintCheckRule: OffloadRule = {
  id: "lint-check",
  description: "Runs mechanical style/hygiene checks over attached files and lists the issues",
  operations: OPERATIONS,
  evaluate(task) {
    if (!hasOperation(task, OPERATIONS)) {
      if (!MENTIONS_LINT.test(task.prompt)) return decline("not a lint request");
      const verb = reasoningVerb(task.prompt);
      if (verb !== undefined) return declineReasoning(verb);
    }

    const files = task.inputs?.files;
    if (files === undefined || files.length === 0) return decline("no files attached to lint");
    if (totalChars(files) > MAX_INPUT_CHARS) return decline("input is too large for an inline script");
    const maxLineLength = task.inputs?.maxLineLength;

    return {
      matched: true,
      run: () => {
        const issues = lintFiles(files, maxLineLength === undefined ? {} : { maxLineLength });
        if (issues.length === 0) {
          return { ruleId: "lint-check", output: `Lint: no issues found in ${files.length} file(s)`, data: { issues: 0, errors: 0, warnings: 0 } };
        }
        const errors = issues.filter((i) => i.severity === "error").length;
        const warnings = issues.length - errors;
        const filesWithIssues = new Set(issues.map((i) => i.path)).size;
        const lines = [`Lint: ${issues.length} issue(s) in ${filesWithIssues} of ${files.length} file(s) (${errors} error(s), ${warnings} warning(s))`];
        for (const i of issues.slice(0, MAX_ISSUES_SHOWN)) lines.push(`${i.path}:${i.line}:${i.column} ${i.severity} ${i.rule} ${i.message}`);
        if (issues.length > MAX_ISSUES_SHOWN) lines.push(`… and ${issues.length - MAX_ISSUES_SHOWN} more`);
        return { ruleId: "lint-check", output: lines.join("\n"), data: { issues: issues.length, errors, warnings } };
      },
    };
  },
};
