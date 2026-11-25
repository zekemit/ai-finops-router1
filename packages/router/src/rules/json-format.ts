import { formatJson } from "../scripts/json";
import { findUnsupportedKeywords, validateJsonSchema } from "../scripts/json-schema";
import type { OffloadRule } from "../types";
import { MAX_INPUT_CHARS, decline, declineReasoning, fencedBlock, hasOperation, reasoningVerb } from "./shared";

const OPERATIONS = ["json.format", "json.validate"] as const;
const NOT_JSON = "not a JSON formatting or validation request";
const MENTIONS_JSON = /\bjson\b/i;
const FORMAT_VERBS = /\b(format|prettify|pretty[- ]?print|beautify|minify|compact|indent|sort)/i;
const INTENT = /\b(format|prettify|pretty[- ]?print|beautify|minify|compact|indent|sort|validate|valid|check|lint|verify|parse)\b/i;

export const jsonFormatRule: OffloadRule = {
  id: "json-format",
  description: "Validates, formats, minifies and schema-checks a JSON document",
  operations: OPERATIONS,
  evaluate(task) {
    const explicit = hasOperation(task, OPERATIONS);
    if (!explicit) {
      if (!MENTIONS_JSON.test(task.prompt)) return decline(NOT_JSON);
      const verb = reasoningVerb(task.prompt);
      if (verb !== undefined) return declineReasoning(verb);
      if (!INTENT.test(task.prompt)) return decline(NOT_JSON);
    }

    const text = task.inputs?.text ?? fencedBlock(task.prompt);
    if (text === undefined || text.trim() === "") return decline("no JSON document attached (inputs.text or a fenced code block)");
    if (text.length > MAX_INPUT_CHARS) return decline("input is too large for an inline script");

    const schema = task.inputs?.schema;
    if (schema !== undefined) {
      const unsupported = findUnsupportedKeywords(schema);
      if (unsupported.length > 0) return decline(`schema uses unsupported keyword(s): ${unsupported.join(", ")}`);
    }

    const mode = task.inputs?.mode ?? (/\b(minify|compact)\b/i.test(task.prompt) ? "minify" : "pretty");
    const indent = task.inputs?.indent ?? 2;
    const sortKeys = task.inputs?.sortKeys ?? /\bsort(?:ed)?\s+(?:the\s+)?(?:object\s+)?keys\b/i.test(task.prompt);
    const showFormatted = task.operation === "json.format" || task.inputs?.mode !== undefined || FORMAT_VERBS.test(task.prompt);

    return {
      matched: true,
      run: () => {
        const result = formatJson(text, { mode, indent, sortKeys });
        if (!result.ok) {
          return { ruleId: "json-format", output: `Invalid JSON: ${result.error.message}`, data: { valid: false, schemaIssues: 0 } };
        }
        const parts = ["Valid JSON."];
        if (showFormatted) parts.push(result.formatted);
        let schemaIssues = 0;
        if (schema !== undefined) {
          const issues = validateJsonSchema(JSON.parse(text), schema);
          schemaIssues = issues.length;
          parts.push(
            issues.length === 0
              ? "Schema validation passed."
              : `Schema validation failed (${issues.length} issue(s)):\n${issues.map((i) => `  ${i.path} ${i.message}`).join("\n")}`,
          );
        }
        return { ruleId: "json-format", output: parts.join("\n\n"), data: { valid: true, schemaIssues } };
      },
    };
  },
};
