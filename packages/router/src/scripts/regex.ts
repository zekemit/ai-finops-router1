/**
 * Pattern compilation for user/agent-supplied regular expressions. The router sits in front of an
 * agent loop, so a catastrophic-backtracking pattern must never be able to hang it.
 */

const MAX_PATTERN_LENGTH = 256;

/** A group containing a quantifier that is itself quantified: (a+)+  (x+x+)+  (a*)*  (.*a){12}  (a|b*)* */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d+,?\d*\})/;

/** Conservative: may reject some harmless patterns (the task then falls back to the LLM), never accepts the classic ReDoS shapes. */
export function isSafePattern(pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return false;
  return !NESTED_QUANTIFIER.test(pattern);
}

export type CompileResult =
  | { readonly ok: true; readonly regex: RegExp }
  | { readonly ok: false; readonly reason: string };

export interface CompileOptions {
  /** Treat the pattern as a regular expression; otherwise as literal text. */
  readonly regex: boolean;
  readonly caseInsensitive: boolean;
}

function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compile to a stateless (non-global) RegExp, or explain why not. Never throws. */
export function compilePattern(pattern: string, options: CompileOptions): CompileResult {
  if (pattern === "") return { ok: false, reason: "empty pattern" };
  if (options.regex && !isSafePattern(pattern)) {
    return { ok: false, reason: "regular expression is too long or could cause catastrophic backtracking" };
  }
  try {
    const source = options.regex ? pattern : escapeLiteral(pattern);
    return { ok: true, regex: new RegExp(source, options.caseInsensitive ? "i" : "") };
  } catch (error) {
    return { ok: false, reason: `invalid regular expression: ${error instanceof Error ? error.message : String(error)}` };
  }
}
