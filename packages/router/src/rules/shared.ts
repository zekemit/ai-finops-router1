import type { RuleVerdict, SourceFile, SubagentTask } from "../types";

/** Inline scripts refuse inputs larger than this: the router must never be able to stall an agent loop. */
export const MAX_INPUT_CHARS = 2_000_000;

/** Verbs that mean "use judgement" rather than "run a mechanical check". Any hit sends the task to the LLM. */
const REASONING =
  /\b(fix|repair|correct|refactor|rewrite|explain|why|how (?:do|does|did|should|can|could)|should|suggest|recommend|review|improve|optimi[sz]e|root cause|debug|diagnos\w*|analy[sz]e|investigate|implement|resolve|decide|compare|evaluate|assess)\b/i;

export const decline = (reason: string): RuleVerdict => ({ matched: false, reason });

export function reasoningVerb(prompt: string): string | undefined {
  return REASONING.exec(prompt)?.[0].toLowerCase();
}

export const declineReasoning = (verb: string): RuleVerdict => decline(`needs judgement, not a mechanical script ("${verb}")`);

/** Contents of the first fenced code block in the prompt, if non-empty. */
export function fencedBlock(prompt: string): string | undefined {
  const body = /```[\w-]*\r?\n([\s\S]*?)```/.exec(prompt)?.[1];
  return body !== undefined && body.trim() !== "" ? body : undefined;
}

/** Text inside backticks, then double quotes, then single quotes: the first that exists. */
export function quotedToken(prompt: string): string | undefined {
  for (const pattern of [/`([^`\n]{1,256})`/, /"([^"\n]{1,256})"/, /'([^'\n]{1,256})'/]) {
    const found = pattern.exec(prompt)?.[1];
    if (found !== undefined && found !== "") return found;
  }
  return undefined;
}

export function totalChars(files: readonly SourceFile[]): number {
  return files.reduce((sum, file) => sum + file.path.length + file.content.length, 0);
}

export function hasOperation(task: SubagentTask, operations: readonly string[]): boolean {
  return task.operation !== undefined && operations.includes(task.operation);
}
