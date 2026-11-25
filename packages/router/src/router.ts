import { DEFAULT_PRICING } from "@ai-finops/interceptor";
import type { PricingTable } from "@ai-finops/interceptor";
import { DEFAULT_RULES } from "./rules";
import { buildOffloadRecord } from "./savings";
import { estimateTokens } from "./tokens";
import type { TokenEstimator } from "./tokens";
import type { ConsideredRule, LlmDecision, OffloadRecord, OffloadRule, RouteDecision, ScriptDecision, SubagentTask } from "./types";

export interface RouterOptions {
  /** Rules in evaluation order. Defaults to the four built-in rules. */
  readonly rules?: readonly OffloadRule[];
  readonly pricing?: PricingTable;
  /** Token counter for text the LLM never saw. Defaults to the ~4 chars/token heuristic. */
  readonly estimateTokens?: TokenEstimator;
  /** Called once per offloaded call by `handle()`. This is the savings log. */
  readonly onOffload?: (record: OffloadRecord) => void;
}

export type HandledResult<R> =
  | { readonly route: "script"; readonly decision: ScriptDecision; readonly output: string }
  | { readonly route: "llm"; readonly decision: LlmDecision; readonly response: R };

export interface Router {
  /** Pure: decide where a task should go. Does not log, does not call anything. */
  route(task: SubagentTask): RouteDecision;
  /** Intercept a call: run the local script if one applies, otherwise invoke `fallback` (the real LLM call). */
  handle<R>(task: SubagentTask, fallback: (task: SubagentTask) => Promise<R>): Promise<HandledResult<R>>;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createRouter(options: RouterOptions = {}): Router {
  const rules = options.rules ?? DEFAULT_RULES;
  const context = { pricing: options.pricing ?? DEFAULT_PRICING, estimate: options.estimateTokens ?? estimateTokens };

  function route(task: SubagentTask): RouteDecision {
    let candidates = rules;
    if (task.operation !== undefined) {
      const operation = task.operation;
      candidates = rules.filter((rule) => rule.operations?.includes(operation) ?? false);
      if (candidates.length === 0) {
        return { route: "llm", taskId: task.id, reason: `no rule handles operation ${JSON.stringify(operation)}`, considered: [] };
      }
    }

    const considered: ConsideredRule[] = [];
    for (const rule of candidates) {
      try {
        const verdict = rule.evaluate(task);
        if (!verdict.matched) {
          considered.push({ ruleId: rule.id, reason: verdict.reason });
          continue;
        }
        const outcome = verdict.run();
        return { route: "script", taskId: task.id, ruleId: rule.id, outcome, record: buildOffloadRecord(task, rule.id, outcome, context) };
      } catch (error) {
        // A faulty script must never take the agent down with it: skip the rule, let the LLM handle the task.
        considered.push({ ruleId: rule.id, reason: `script error: ${errorMessage(error)}` });
      }
    }
    return { route: "llm", taskId: task.id, reason: "no deterministic rule matched", considered };
  }

  async function handle<R>(task: SubagentTask, fallback: (task: SubagentTask) => Promise<R>): Promise<HandledResult<R>> {
    const decision = route(task);
    if (decision.route === "script") {
      options.onOffload?.(decision.record);
      return { route: "script", decision, output: decision.outcome.output };
    }
    return { route: "llm", decision, response: await fallback(task) };
  }

  return { route, handle };
}
