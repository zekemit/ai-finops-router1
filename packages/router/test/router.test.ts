import { describe, expect, it, vi } from "vitest";
import { createRouter } from "../src/router";
import { estimateTokens } from "../src/tokens";
import type { OffloadRecord, OffloadRule, RouteDecision, SubagentTask } from "../src/types";
import { fixture, makeTask } from "./helpers";

const files = [
  { path: "src/a.ts", content: "export function foo() {}\nconst x = foo();\n" },
  { path: "src/b.ts", content: "import { foo } from './a';\n" },
];

const canonical: readonly { name: string; task: SubagentTask; rule: string }[] = [
  { name: "JSON formatting", rule: "json-format", task: makeTask({ id: "j", prompt: "Format this JSON", inputs: { text: '{"b":1,"a":2}' } }) },
  { name: "test-output parsing", rule: "test-summary", task: makeTask({ id: "t", prompt: "Summarize the test output", inputs: { text: fixture("vitest-fail.txt") } }) },
  { name: "linting", rule: "lint-check", task: makeTask({ id: "l", prompt: "Run lint on these files and list the issues", inputs: { files: [{ path: "a.ts", content: "x  \n" }] } }) },
  { name: "regex file search", rule: "grep-search", task: makeTask({ id: "g", prompt: "Find all usages of `foo`", inputs: { files } }) },
];

const scriptOf = (decision: RouteDecision) => {
  if (decision.route !== "script") throw new Error(`expected a script route, got llm: ${decision.reason}`);
  return decision;
};

describe("createRouter().route — deterministic rules", () => {
  it.each(canonical)("routes $name to the $rule script", ({ task, rule }) => {
    const decision = scriptOf(createRouter().route(task));
    expect(decision.ruleId).toBe(rule);
    expect(decision.taskId).toBe(task.id);
    expect(decision.outcome.output.length).toBeGreaterThan(0);
  });

  it("sends reasoning work to the LLM and records why each rule declined, in rule order", () => {
    const decision = createRouter().route(makeTask({ prompt: "Design the authentication architecture for the new billing service" }));
    expect(decision.route).toBe("llm");
    if (decision.route !== "llm") return;
    expect(decision.considered.map((c) => c.ruleId)).toEqual(["json-format", "test-summary", "lint-check", "grep-search"]);
    expect(decision.considered.every((c) => c.reason.length > 0)).toBe(true);
  });

  it("does not offload a mechanical-sounding task that actually needs judgement", () => {
    const decision = createRouter().route(makeTask({ prompt: "Fix the lint errors in these files", inputs: { files } }));
    expect(decision.route).toBe("llm");
  });

  it("lets an explicit operation pick the rule, ahead of what the prompt happens to mention", () => {
    const task = makeTask({ prompt: "this JSON thing is odd", operation: "grep", inputs: { files, pattern: "foo" } });
    expect(scriptOf(createRouter().route(task)).ruleId).toBe("grep-search");
  });

  it("sends an unknown explicit operation to the LLM rather than guessing", () => {
    const decision = createRouter().route(makeTask({ prompt: "Format this JSON", operation: "teleport", inputs: { text: "{}" } }));
    expect(decision.route).toBe("llm");
    if (decision.route === "llm") expect(decision.reason).toContain("teleport");
  });

  it("is deterministic: the same task always yields the same decision, and it never reads a clock", () => {
    const router = createRouter();
    const task = canonical[0]?.task ?? makeTask({ prompt: "x" });
    const first = router.route(task);
    const second = createRouter().route(task);
    expect(second).toEqual(first);
    expect(scriptOf(first).record.timestamp).toBe(task.timestamp);
  });

  it("skips a rule whose script throws and carries on, falling back to the LLM if nothing else handles it", () => {
    const exploding: OffloadRule = {
      id: "json-format",
      description: "always throws",
      evaluate: () => ({
        matched: true,
        run: () => {
          throw new Error("boom");
        },
      }),
    };
    const decision = createRouter({ rules: [exploding] }).route(makeTask({ prompt: "anything" }));
    expect(decision.route).toBe("llm");
    if (decision.route === "llm") expect(decision.considered[0]?.reason).toContain("script error: boom");
  });
});

describe("savings accounting", () => {
  // 1 character = 1 token makes every figure below hand-checkable.
  const charEstimator = { estimateTokens: (text: string) => text.length };
  const task = makeTask({ prompt: "Format this JSON", inputs: { text: '{"b":1}' }, contextTokens: 20_000 });

  it("prices the LLM call that did not happen: payload + re-read context + output, at the task model's rates", () => {
    const { record, outcome } = scriptOf(createRouter(charEstimator).route(task));
    const outputTokens = outcome.output.length;
    expect(outputTokens).toBe(25); // 'Valid JSON.\n\n{\n  "b": 1\n}'

    expect(record.avoided_input_tokens).toBe(16 + 7); // prompt + attached document
    expect(record.avoided_cache_read_tokens).toBe(20_000);
    expect(record.avoided_output_tokens).toBe(25);
    expect(record.avoided_tokens).toBe(23 + 20_000 + 25);

    // sonnet-5-5: $2/MTok input, $10/MTok output, $0.10/MTok cache read
    expect(record.offloaded_savings_usd).toBeCloseTo((23 * 2 + 25 * 10 + 20_000 * 0.1) / 1_000_000, 12);
    expect(record.priced).toBe(true);
  });

  it("prices at the model the agent would have called", () => {
    const opus = scriptOf(createRouter(charEstimator).route({ ...task, model: "claude-opus-5-5" })).record;
    // opus-5-5: $4 input, $20 output, $0.20 cache read
    expect(opus.offloaded_savings_usd).toBeCloseTo((23 * 4 + 25 * 20 + 20_000 * 0.2) / 1_000_000, 12);
  });

  it("emits the documented log-record shape", () => {
    const { record } = scriptOf(createRouter(charEstimator).route(task));
    expect(Object.keys(record).sort()).toEqual(
      [
        "agent",
        "avoided_cache_read_tokens",
        "avoided_input_tokens",
        "avoided_output_tokens",
        "avoided_tokens",
        "model",
        "offloaded_savings_usd",
        "priced",
        "rule_id",
        "task_id",
        "timestamp",
        "token_counts",
      ].sort(),
    );
    expect(record).toMatchObject({ task_id: "task-1", agent: "Security_Agent", rule_id: "json-format", model: "claude-sonnet-5-5", token_counts: "estimated" });
  });

  it("assumes no re-read context unless the task says so, so savings are a conservative floor", () => {
    const { record } = scriptOf(createRouter(charEstimator).route(makeTask({ prompt: "Format this JSON", inputs: { text: "{}" } })));
    expect(record.avoided_cache_read_tokens).toBe(0);
  });

  it("ignores an invalid contextTokens instead of failing", () => {
    for (const bad of [-5, 1.5, Number.NaN]) {
      const { record } = scriptOf(createRouter(charEstimator).route({ ...task, contextTokens: bad }));
      expect(record.avoided_cache_read_tokens).toBe(0);
    }
  });

  it("still offloads when the model has no pricing, but claims no dollars", () => {
    const { record } = scriptOf(createRouter(charEstimator).route({ ...task, model: "mystery-model" }));
    expect(record.priced).toBe(false);
    expect(record.offloaded_savings_usd).toBe(0);
    expect(record.avoided_tokens).toBeGreaterThan(0);
  });

  it("accepts a caller-supplied pricing table", () => {
    const pricing = {
      "my-model": { model: "my-model", inputPerMTok: 1_000_000, outputPerMTok: 0, cacheReadPerMTok: 0, cacheWrite5mPerMTok: 0, cacheWrite1hPerMTok: 0, source: "documented" as const },
    };
    const { record } = scriptOf(createRouter({ ...charEstimator, pricing }).route({ ...task, model: "my-model" }));
    expect(record.offloaded_savings_usd).toBe(23); // 23 input tokens at $1 per token
  });

  it("counts the files and schema attached to a task as avoided input", () => {
    const withFiles = makeTask({ prompt: "Lint these files", inputs: { files: [{ path: "a.ts", content: "x  \n" }] } });
    const { record } = scriptOf(createRouter(charEstimator).route(withFiles));
    expect(record.avoided_input_tokens).toBe("Lint these files".length + "a.ts\nx  \n".length);
  });
});

describe("estimateTokens", () => {
  it("is a documented heuristic of one token per four characters, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("defaults to that heuristic when no estimator is supplied", () => {
    const { record } = scriptOf(createRouter().route(makeTask({ prompt: "Format this JSON", inputs: { text: "{}" } })));
    expect(record.avoided_input_tokens).toBe(estimateTokens("Format this JSON") + estimateTokens("{}"));
  });
});

describe("createRouter().handle — the LLM is bypassed", () => {
  it.each(canonical)("never calls the LLM for $name, and returns the script's answer", async ({ task }) => {
    const llm = vi.fn(async () => "LLM ANSWER");
    const result = await createRouter().handle(task, llm);
    expect(llm).not.toHaveBeenCalled();
    expect(result.route).toBe("script");
    if (result.route === "script") expect(result.output).toBe(result.decision.outcome.output);
  });

  it("calls the LLM exactly once, with the original task, for work that needs it", async () => {
    const llm = vi.fn(async (_task: SubagentTask) => "LLM ANSWER");
    const task = makeTask({ prompt: "Design the authentication architecture" });
    const result = await createRouter().handle(task, llm);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(llm).toHaveBeenCalledWith(task);
    expect(result).toMatchObject({ route: "llm", response: "LLM ANSWER" });
  });

  it("falls back to the LLM when a script blows up, so the agent never fails because of the router", async () => {
    const exploding: OffloadRule = {
      id: "grep-search",
      description: "throws",
      evaluate: () => ({ matched: true, run: () => { throw new Error("boom"); } }),
    };
    const llm = vi.fn(async () => "LLM ANSWER");
    const result = await createRouter({ rules: [exploding] }).handle(makeTask({ prompt: "x" }), llm);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(result.route).toBe("llm");
  });

  it("propagates an error from the LLM fallback unchanged", async () => {
    const llm = async (): Promise<string> => {
      throw new Error("rate limited");
    };
    await expect(createRouter().handle(makeTask({ prompt: "Design something" }), llm)).rejects.toThrow("rate limited");
  });

  it("logs exactly one savings record per offloaded call and none for LLM calls", async () => {
    const records: OffloadRecord[] = [];
    const router = createRouter({ onOffload: (record) => records.push(record) });
    const llm = async () => "x";
    for (const { task } of canonical) await router.handle(task, llm);
    await router.handle(makeTask({ id: "llm-1", prompt: "Design the authentication architecture" }), llm);
    expect(records.map((r) => r.task_id)).toEqual(["j", "t", "l", "g"]);
    expect(records.map((r) => r.rule_id)).toEqual(["json-format", "test-summary", "lint-check", "grep-search"]);
  });

  it("does not log from route(), so a dry run cannot double-count savings", () => {
    const onOffload = vi.fn();
    createRouter({ onOffload }).route(canonical[0]?.task ?? makeTask({ prompt: "x" }));
    expect(onOffload).not.toHaveBeenCalled();
  });
});
