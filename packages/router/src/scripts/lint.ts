import type { SourceFile } from "../types";

export type LintRuleId =
  | "no-trailing-spaces"
  | "no-mixed-indent"
  | "max-len"
  | "eol-last"
  | "no-debugger"
  | "no-conflict-markers";

export interface LintIssue {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly rule: LintRuleId;
  readonly severity: "error" | "warning";
  readonly message: string;
}

export interface LintOptions {
  /** Default 120. */
  readonly maxLineLength?: number;
}

const JS_LIKE = /\.(?:[cm]?[jt]sx?)$/;
const CONFLICT_MARKER = /^(?:<{7}|={7}|>{7})(?:\s|$)/;

/**
 * Hygiene lint over in-memory files: the mechanical checks nobody needs a language model for.
 * Deterministic and dependency-free; it does not replace a project's own ESLint config.
 */
export function lintFiles(files: readonly SourceFile[], options: LintOptions = {}): LintIssue[] {
  const maxLen = options.maxLineLength ?? 120;
  const issues: LintIssue[] = [];

  for (const { path, content } of files) {
    const add = (line: number, column: number, rule: LintRuleId, severity: LintIssue["severity"], message: string): void => {
      issues.push({ path, line, column, rule, severity, message });
    };
    const endsWithNewline = content.endsWith("\n");
    const rawLines = content.split("\n");
    if (endsWithNewline) rawLines.pop();
    const jsLike = JS_LIKE.test(path);

    rawLines.forEach((raw, index) => {
      const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      const line = index + 1;

      const trailing = /[ \t]+$/.exec(text);
      if (trailing !== null) add(line, trailing.index + 1, "no-trailing-spaces", "warning", "trailing whitespace");

      const indent = /^[ \t]+/.exec(text)?.[0] ?? "";
      const jsdocContinuation = /^\t+ $/.test(indent) && text[indent.length] === "*";
      if (indent.includes(" ") && indent.includes("\t") && !jsdocContinuation) {
        add(line, 1, "no-mixed-indent", "error", "indentation mixes tabs and spaces");
      }

      if (text.length > maxLen) add(line, maxLen + 1, "max-len", "warning", `line is ${text.length} characters (max ${maxLen})`);

      if (jsLike && /^\s*debugger\s*;?\s*$/.test(text)) add(line, text.indexOf("debugger") + 1, "no-debugger", "error", "unexpected debugger statement");

      if (CONFLICT_MARKER.test(text)) add(line, 1, "no-conflict-markers", "error", "merge conflict marker");
    });

    if (content.length > 0 && !endsWithNewline) {
      const last = rawLines[rawLines.length - 1] ?? "";
      add(rawLines.length, last.length + 1, "eol-last", "warning", "file does not end with a newline");
    }
  }

  return issues.sort(
    (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.line - b.line || a.column - b.column || (a.rule < b.rule ? -1 : 1),
  );
}
