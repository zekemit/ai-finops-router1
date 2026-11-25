import { grepFiles } from "../scripts/grep";
import { compilePattern } from "../scripts/regex";
import type { OffloadRule } from "../types";
import { MAX_INPUT_CHARS, decline, declineReasoning, hasOperation, quotedToken, reasoningVerb, totalChars } from "./shared";

const OPERATIONS = ["grep", "search"] as const;
const NOT_SEARCH = "not a search request";
const MENTIONS_SEARCH = /\b(grep|search|find|usages?|occurrences?|references?|where)\b/i;
const INTENT =
  /\b(grep|usages?|occurrences?|references?|uses of|where (?:is|are)\b|(?:files?|lines?) (?:containing|matching|with)|search (?:for|the (?:code|repo|codebase|files)))/i;
const MAX_MATCHES_SHOWN = 50;

export const grepSearchRule: OffloadRule = {
  id: "grep-search",
  description: "grep-style literal or regex search across attached files",
  operations: OPERATIONS,
  evaluate(task) {
    if (!hasOperation(task, OPERATIONS)) {
      if (!MENTIONS_SEARCH.test(task.prompt)) return decline(NOT_SEARCH);
      const verb = reasoningVerb(task.prompt);
      if (verb !== undefined) return declineReasoning(verb);
      if (!INTENT.test(task.prompt)) return decline(NOT_SEARCH);
    }

    const files = task.inputs?.files;
    if (files === undefined || files.length === 0) return decline("no files attached to search");
    if (totalChars(files) > MAX_INPUT_CHARS) return decline("input is too large for an inline script");

    const pattern = task.inputs?.pattern ?? quotedToken(task.prompt);
    if (pattern === undefined) return decline("no search pattern given (use inputs.pattern or quote it in the prompt)");

    const caseInsensitive = task.inputs?.caseInsensitive ?? /case[- ]insensitive|ignore case/i.test(task.prompt);
    const compiled = compilePattern(pattern, { regex: task.inputs?.regex === true, caseInsensitive });
    if (!compiled.ok) return decline(`pattern rejected: ${compiled.reason}`);

    return {
      matched: true,
      run: () => {
        const result = grepFiles(files, compiled.regex, { maxMatches: MAX_MATCHES_SHOWN });
        const data = { totalMatches: result.totalMatches, filesWithMatches: result.filesWithMatches, truncated: result.truncated };
        if (result.totalMatches === 0) {
          return { ruleId: "grep-search", output: `No matches for "${pattern}" in ${files.length} file(s).`, data };
        }
        const lines = [`Found ${result.totalMatches} match(es) in ${result.filesWithMatches} file(s):`];
        for (const m of result.matches) lines.push(`${m.path}:${m.line}:${m.column}: ${m.text}`);
        if (result.truncated) lines.push(`(showing first ${result.matches.length} of ${result.totalMatches} matches)`);
        return { ruleId: "grep-search", output: lines.join("\n"), data };
      },
    };
  },
};
