import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SubagentTask } from "../src/types";

export const fixture = (name: string): string => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

export function makeTask(o: Partial<SubagentTask> & { prompt: string }): SubagentTask {
  return {
    id: o.id ?? "task-1",
    timestamp: o.timestamp ?? "2026-11-25T10:00:00.000Z",
    agent: o.agent ?? "Security_Agent",
    model: o.model ?? "claude-sonnet-5-5",
    prompt: o.prompt,
    ...(o.operation === undefined ? {} : { operation: o.operation }),
    ...(o.inputs === undefined ? {} : { inputs: o.inputs }),
    ...(o.contextTokens === undefined ? {} : { contextTokens: o.contextTokens }),
  };
}
