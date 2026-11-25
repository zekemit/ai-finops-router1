/**
 * A deterministic stream of Claude Code session-log lines, plus the mechanical tasks a router would intercept.
 *
 * The lines copy the real format: one JSONL line per content block, each repeating the call's full `usage`, all
 * sharing one `message.id` and `requestId`. That repetition is exactly what makes a naive sum overcount, and it is
 * what the real parser de-duplicates. Tasks are real `SubagentTask`s that the real router answers with scripts.
 */
import type { SubagentTask } from "@ai-finops/router";
import { createRng } from "./rng";
import type { Rng } from "./rng";

export const STREAM_EPOCH_MS = Date.parse("2026-11-03T09:00:00.000Z");
const SESSION_ID = "stream-demo";

export type StreamStep =
  | {
      readonly kind: "line";
      readonly atMs: number;
      readonly line: string;
      readonly callIndex: number;
      readonly blockIndex: number;
      readonly blockCount: number;
    }
  | { readonly kind: "task"; readonly atMs: number; readonly task: SubagentTask };

type BlockType = "thinking" | "text" | "tool_use";

const AGENTS = ["PM_Agent", "Architect_Agent", "Security_Agent", "Release_Agent"] as const;
const TOOLS = ["Bash", "Read", "Grep", "Edit"] as const;

const SOURCE = [
  'import { normalizeInvoice } from "./normalize";',
  "",
  "export function parseInvoice(input: string): string {",
  "  const normalized = normalizeInvoice(input);",
  "  if (normalized.length === 0) {",
  '    throw new Error("empty invoice");',
  "  }",
  "  return normalized;",
  "}",
  "",
];

const hex = (rng: Rng, length: number): string => Array.from({ length }, () => rng.int(0, 15).toString(16)).join("");

function blockTypes(rng: Rng, count: number): BlockType[] {
  if (count === 1) return [rng.pick(["text", "tool_use"] as const)];
  if (count === 2) return [rng.pick(["thinking", "text"] as const), "tool_use"];
  if (count === 3) return ["thinking", "text", "tool_use"];
  return ["thinking", "text", "tool_use", "tool_use"];
}

function blockCountFor(rng: Rng): number {
  const roll = rng.next();
  if (roll < 0.3) return 1;
  if (roll < 0.65) return 2;
  if (roll < 0.9) return 3;
  return 4;
}

function contentBlock(rng: Rng, type: BlockType): Record<string, unknown> {
  if (type === "thinking") return { type, thinking: "Weighing the options before committing to a change.", signature: hex(rng, 24) };
  if (type === "text") return { type, text: rng.pick(["Reading the failing test first.", "Applying the fix now.", "That matches the spec."]) };
  const name = rng.pick(TOOLS);
  return { type, id: `toolu_${hex(rng, 18)}`, name, input: name === "Bash" ? { command: rng.pick(["npm test", "git diff --stat", "ls src"]) } : { path: `src/${rng.pick(["invoice", "ledger", "quota"])}.ts` } };
}

function taskFor(rng: Rng, index: number, atMs: number, model: string, contextTokens: number): SubagentTask {
  const files = [
    { path: "src/invoice.ts", content: SOURCE.join("\n") + (rng.chance(0.5) ? "\n" : "  \n") },
    { path: "src/ledger.ts", content: SOURCE.join("\n").replace("Invoice", "Ledger") + "\n" },
  ];
  const base = { id: `t${index}`, timestamp: new Date(atMs).toISOString(), agent: AGENTS[index % AGENTS.length] ?? "PM_Agent", model, contextTokens };
  switch (index % 4) {
    case 0:
      return { ...base, prompt: "Run lint on the changed files and list the issues", inputs: { files } };
    case 1:
      return { ...base, prompt: `Find all occurrences of \`${rng.pick(["normalize", "throw new Error", "export function"])}\` in the codebase`, inputs: { files } };
    case 2:
      return {
        ...base,
        prompt: "Validate this JSON against the schema",
        inputs: {
          text: JSON.stringify({ id: `F-${100 + index}`, title: "Usage export", priority: rng.pick(["P0", "P1", "P2"]) }, null, 2),
          schema: { type: "object", required: ["id", "title", "priority"], properties: { priority: { enum: ["P0", "P1", "P2"] } } },
        },
      };
    default:
      return {
        ...base,
        prompt: "Summarize the test output",
        inputs: { text: ` Test Files  ${rng.int(5, 9)} passed (9)\n      Tests  ${rng.int(120, 180)} passed (180)\n   Duration  1.${rng.int(10, 99)}s\n` },
      };
  }
}

/** `calls` billed calls as log lines, with a router task after roughly half of them. */
export function generateStream(seed: number, calls: number): StreamStep[] {
  const rng = createRng(seed);
  const steps: StreamStep[] = [];
  let atMs = STREAM_EPOCH_MS;
  let previousUuid: string | null = null;
  let taskIndex = 0;

  for (let callIndex = 0; callIndex < calls; callIndex += 1) {
    atMs += rng.int(2_500, 7_000);
    const model = rng.chance(0.25) ? "claude-opus-5-5" : "claude-sonnet-5-5";
    const cacheRead = rng.int(45_000, 140_000);
    const write = rng.int(1_200, 9_000);
    const oneHour = rng.chance(0.3);
    const usage = {
      input_tokens: rng.int(1, 40),
      cache_creation_input_tokens: write,
      cache_read_input_tokens: cacheRead,
      output_tokens: model === "claude-opus-5-5" ? rng.int(600, 3_800) : rng.int(150, 2_400),
      service_tier: "standard",
      cache_creation: { ephemeral_5m_input_tokens: oneHour ? 0 : write, ephemeral_1h_input_tokens: oneHour ? write : 0 },
    };
    const messageId = `msg_${callIndex.toString(16).padStart(3, "0")}${hex(rng, 13)}`;
    const requestId = `req_${callIndex.toString(16).padStart(3, "0")}${hex(rng, 13)}`;
    const types = blockTypes(rng, blockCountFor(rng));

    types.forEach((type, blockIndex) => {
      if (blockIndex > 0) atMs += rng.int(120, 600);
      const uuid = `${hex(rng, 8)}-${callIndex.toString(16).padStart(4, "0")}-${blockIndex}`;
      const lastBlock = blockIndex === types.length - 1;
      const line = JSON.stringify({
        parentUuid: previousUuid,
        isSidechain: false,
        type: "assistant",
        uuid,
        timestamp: new Date(atMs).toISOString(),
        sessionId: SESSION_ID,
        requestId,
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          model,
          content: [contentBlock(rng, type)],
          stop_reason: lastBlock ? (type === "tool_use" ? "tool_use" : "end_turn") : null,
          usage,
        },
      });
      previousUuid = uuid;
      steps.push({ kind: "line", atMs, line, callIndex, blockIndex, blockCount: types.length });
    });

    if (rng.chance(0.55)) {
      atMs += rng.int(400, 1_200);
      steps.push({ kind: "task", atMs, task: taskFor(rng, taskIndex, atMs, model, cacheRead) });
      taskIndex += 1;
    }
  }
  return steps;
}
