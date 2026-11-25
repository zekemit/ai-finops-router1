/**
 * Sprint generator: a deterministic, timed stream of subagent tasks for the live simulator.
 *
 * Every task is a real `SubagentTask`. Mechanical ones (validate JSON, lint, grep, summarise test output)
 * carry realistic payloads and are answered by the real router scripts; judgement work (specs, design,
 * review, release notes) reaches the model, with usage drawn from distributions shaped like real
 * Claude Code sessions (95%+ of the prompt served from cache). `intent` records what the author meant,
 * so tests can prove the router agrees.
 */
import { makeUsage } from "@ai-finops/interceptor";
import type { AgentName, Milestone, TokenUsage } from "@ai-finops/interceptor";
import type { SubagentTask, TaskInputs } from "@ai-finops/router";
import { createRng } from "./rng";
import { SPEC_SCHEMA, sampleChangelogJson, sampleSourceFiles, sampleSpecJson, sampleVitestOutput } from "./sample-data";

/** One feature flows through all four agents inside this window. */
export const FEATURE_SPAN_MS = 270_000;

/** The Security_Agent's stuck request: identical every retry, which is what the loop detector keys on. */
export const LOOP_PROMPT = "Resolve the high-severity vulnerabilities reported by npm audit";

const SECRET_PATTERN = "(api[_-]?key|secret|password)\\s*[:=]";
const TITLES = ["Usage export", "Budget alerts", "Per-team quotas", "Invoice reconciliation", "Cache hit report", "Seat management", "Audit trail", "Cost allocation tags"] as const;
const GREP_PATTERNS = ["throw new Error", "normalize", "export function"] as const;

export interface SimLlmResult {
  readonly usage: TokenUsage;
  readonly latencyMs: number;
  readonly featureId: string;
  readonly milestone?: Milestone;
}

export interface SimItem {
  /** Epoch ms at which the agent issues the task. */
  readonly atMs: number;
  readonly sessionId: string;
  readonly task: SubagentTask;
  /** What the model would answer with, if the task reaches it. Ignored when a script handles it. */
  readonly llm: SimLlmResult;
  /** What the scenario author expects the router to do (used by tests; the engine always asks the router). */
  readonly intent: "script" | "llm";
}

export interface SprintOptions {
  readonly seed: number;
  readonly sprintIndex: number;
  readonly startMs: number;
  readonly features: number;
  /** Zero-based feature during which the Security_Agent gets stuck retrying. */
  readonly loopOnFeature?: number;
}

interface Profile {
  readonly model: string;
  readonly context: readonly [number, number];
  readonly tokensPerSecond: number;
}

const PROFILES: Readonly<Record<AgentName, Profile>> = {
  PM_Agent: { model: "claude-sonnet-5-5", context: [30_000, 60_000], tokensPerSecond: 70 },
  Architect_Agent: { model: "claude-opus-5-5", context: [80_000, 140_000], tokensPerSecond: 60 },
  Security_Agent: { model: "claude-sonnet-5-5", context: [50_000, 90_000], tokensPerSecond: 70 },
  Release_Agent: { model: "claude-sonnet-5-5", context: [40_000, 80_000], tokensPerSecond: 70 },
};

type Range = readonly [number, number];

interface LlmShape {
  readonly output: Range;
  readonly write: Range;
  readonly oneHourWrites?: boolean;
}

interface StepBase {
  readonly agent: AgentName;
  readonly step: string;
  readonly offsetSec: number;
  readonly prompt: string;
}
type Step = StepBase & ({ readonly kind: "llm"; readonly shape: LlmShape; readonly ships?: true } | { readonly kind: "script"; readonly operationInputs: TaskInputs });

export function generateSprint(options: SprintOptions): SimItem[] {
  const { sprintIndex, startMs, features, loopOnFeature } = options;
  const rng = createRng(options.seed * 1_000 + sprintIndex * 7 + 1);
  const sessionId = `sprint-${sprintIndex}`;
  const items: SimItem[] = [];

  const usageFor = (profile: Profile, context: number, shape: LlmShape): { usage: TokenUsage; latencyMs: number } => {
    const output = rng.int(shape.output[0], shape.output[1]);
    const write = rng.int(shape.write[0], shape.write[1]);
    const oneHour = shape.oneHourWrites === true && rng.chance(0.25);
    return {
      usage: makeUsage({
        inputTokens: rng.int(1, 40),
        outputTokens: output,
        cacheReadTokens: context,
        cacheWrite5mTokens: oneHour ? 0 : write,
        cacheWrite1hTokens: oneHour ? write : 0,
      }),
      latencyMs: Math.round(rng.range(800, 2_400) + (output / profile.tokensPerSecond) * 1_000),
    };
  };

  for (let k = 0; k < features; k += 1) {
    const featureStart = startMs + k * FEATURE_SPAN_MS;
    const featureId = `S${sprintIndex}-F${k + 1}`;
    const specId = `F-${100 + sprintIndex * 10 + k}`;
    const title = rng.pick(TITLES);
    const changed = sampleSourceFiles(rng, { count: 4, dirtiness: 0.35 });
    const grepPattern = rng.pick(GREP_PATTERNS);
    const specFlaw = rng.chance(0.12) ? "schema" : "none";
    const testCount = rng.int(38, 64);
    const testsFailed = rng.chance(0.2) ? rng.int(1, 3) : 0;

    const steps: Step[] = [
      { agent: "PM_Agent", step: "spec", offsetSec: 0, prompt: `Draft the product spec and acceptance criteria for ${title}`, kind: "llm", shape: { output: [1_500, 3_000], write: [2_000, 5_000] } },
      { agent: "PM_Agent", step: "spec-json", offsetSec: 40, prompt: "Validate this JSON against the schema", kind: "script", operationInputs: { text: sampleSpecJson(rng, specId, title, specFlaw), schema: SPEC_SCHEMA } },
      { agent: "PM_Agent", step: "backlog", offsetSec: 55, prompt: `Prioritise the backlog items that depend on ${title}`, kind: "llm", shape: { output: [800, 1_500], write: [1_500, 3_000] } },
      { agent: "Architect_Agent", step: "design", offsetSec: 70, prompt: `Design the architecture for ${title}, weighing latency against cost`, kind: "llm", shape: { output: [4_000, 9_000], write: [4_000, 9_000], oneHourWrites: true } },
      { agent: "Architect_Agent", step: "usages", offsetSec: 90, prompt: `Find all occurrences of \`${grepPattern}\` in the codebase`, kind: "script", operationInputs: { files: changed } },
      { agent: "Architect_Agent", step: "contract-json", offsetSec: 105, prompt: "Validate this JSON against the schema", kind: "script", operationInputs: { text: sampleSpecJson(rng, specId, title, "none"), schema: SPEC_SCHEMA } },
      { agent: "Architect_Agent", step: "revise", offsetSec: 125, prompt: `Revise the design to address the open questions and write the API contract for ${title}`, kind: "llm", shape: { output: [3_000, 6_000], write: [3_000, 6_000] } },
      { agent: "Architect_Agent", step: "tradeoffs", offsetSec: 150, prompt: `Summarise the trade-offs we accepted for the ${title} rollout plan`, kind: "llm", shape: { output: [1_000, 2_500], write: [1_500, 3_000] } },
      { agent: "Security_Agent", step: "lint", offsetSec: 165, prompt: "Run lint on the changed files and list the issues", kind: "script", operationInputs: { files: changed } },
      { agent: "Security_Agent", step: "secrets", offsetSec: 175, prompt: "Search the codebase for hardcoded credentials", kind: "script", operationInputs: { files: changed, pattern: SECRET_PATTERN, regex: true, caseInsensitive: true } },
      { agent: "Security_Agent", step: "review", offsetSec: 190, prompt: `Review the ${title} changes for injection and authorization flaws`, kind: "llm", shape: { output: [2_000, 4_000], write: [2_000, 4_000] } },
      { agent: "Release_Agent", step: "tests", offsetSec: 230, prompt: "Summarize the test output", kind: "script", operationInputs: { text: sampleVitestOutput(rng, { files: 7, tests: testCount, failed: testsFailed }) } },
      { agent: "Release_Agent", step: "notes", offsetSec: 245, prompt: `Write the release notes for ${title}`, kind: "llm", shape: { output: [1_500, 3_000], write: [1_500, 3_000] } },
      { agent: "Release_Agent", step: "changelog", offsetSec: 252, prompt: "Format this JSON and sort the keys", kind: "script", operationInputs: { text: sampleChangelogJson(rng, featureId) } },
      { agent: "Release_Agent", step: "ship", offsetSec: 262, prompt: `Approve the release of ${title} and tag it`, kind: "llm", shape: { output: [300, 700], write: [500, 1_500] }, ships: true },
    ];

    const emit = (step: Step, atMs: number, id: string): void => {
      const profile = PROFILES[step.agent];
      const context = rng.int(profile.context[0], profile.context[1]);
      const shape: LlmShape = step.kind === "llm" ? step.shape : { output: [200, 600], write: [500, 1_500] };
      const { usage, latencyMs } = usageFor(profile, context, shape);
      const task: SubagentTask = {
        id,
        timestamp: new Date(atMs).toISOString(),
        agent: step.agent,
        model: profile.model,
        prompt: step.prompt,
        contextTokens: context,
        ...(step.kind === "script" ? { inputs: step.operationInputs } : {}),
      };
      const shipped = step.kind === "llm" && step.ships === true;
      items.push({
        atMs,
        sessionId,
        task,
        intent: step.kind,
        llm: { usage, latencyMs, featureId, ...(shipped ? { milestone: "feature_shipped" as const } : {}) },
      });
    };

    for (const step of steps) {
      emit(step, featureStart + Math.round((step.offsetSec + rng.range(0, 6)) * 1_000), `s${sprintIndex}-f${k + 1}-${step.step}`);
    }

    if (loopOnFeature === k) {
      let at = featureStart + 195_000;
      for (let i = 0; i < 9; i += 1) {
        at += Math.round(rng.range(6, 10) * 1_000);
        emit(
          { agent: "Security_Agent", step: "loop", offsetSec: 0, prompt: LOOP_PROMPT, kind: "llm", shape: { output: [2_800, 3_400], write: [1_500, 2_500] } },
          at,
          `s${sprintIndex}-f${k + 1}-loop-${i + 1}`,
        );
      }
    }
  }

  return items.sort((a, b) => a.atMs - b.atMs);
}
