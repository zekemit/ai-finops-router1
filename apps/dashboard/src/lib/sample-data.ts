/**
 * Realistic payloads for the simulated agents: the files, JSON documents and test output that a real
 * subagent would otherwise paste into a prompt. They are sized like real work (a few thousand tokens)
 * and are fed to the REAL router scripts, so every offload in the demo is genuinely computed.
 */
import type { SourceFile } from "@ai-finops/router";
import type { Rng } from "./rng";

const NOUNS = ["invoice", "ledger", "session", "quota", "billing", "token", "cache", "route", "usage", "tenant"] as const;
const VERBS = ["parse", "build", "resolve", "validate", "format", "collect"] as const;
const SCOPES = ["checkout", "export", "admin", "reporting", "webhook"] as const;

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

export interface SampleFilesOptions {
  readonly count: number;
  /** Probability (0-1) that a file carries 1-3 lint issues. 0 is always clean; 1 always has at least one. */
  readonly dirtiness: number;
}

type Dirt = "trailing" | "long" | "mixed" | "debugger" | "eol";
const DIRT: readonly Dirt[] = ["trailing", "long", "mixed", "debugger", "eol"];

function functionBlock(rng: Rng, noun: string, n: number): string[] {
  const Noun = capitalise(noun);
  const verb = rng.pick(VERBS);
  const scope = rng.pick(SCOPES);
  return [
    `/** ${capitalise(verb)} the ${noun} for the ${scope} scope. */`,
    `export function ${verb}${Noun}${n}(input: ${Noun}Input): ${Noun}Result {`,
    `  const normalized = normalize${Noun}(input.value);`,
    "  if (normalized.length === 0) {",
    `    throw new Error("empty ${noun} for ${scope}");`,
    "  }",
    `  const attempts = input.attempts ?? ${rng.int(1, 5)};`,
    `  return { id: "${scope}-${n}", value: normalized, attempts };`,
    "}",
    "",
  ];
}

function sourceFile(rng: Rng, noun: string, index: number, dirtiness: number): SourceFile {
  const Noun = capitalise(noun);
  const lines = [`import type { ${Noun}Input, ${Noun}Result } from "./types";`, `import { normalize${Noun} } from "./normalize";`, ""];
  if (rng.chance(0.3)) lines.push('const apiKey = process.env.API_KEY ?? "";', "");
  const blocks = rng.int(10, 14);
  for (let n = 1; n <= blocks; n += 1) lines.push(...functionBlock(rng, noun, n));

  let endsWithNewline = true;
  if (rng.chance(dirtiness)) {
    const kinds = DIRT.filter(() => rng.chance(0.5));
    if (kinds.length === 0) kinds.push(rng.pick(DIRT));
    for (const kind of kinds) {
      const content = lines.map((line, i) => (line.trim() === "" ? -1 : i)).filter((i) => i >= 0);
      const at = content[rng.int(0, content.length - 1)] ?? 0;
      if (kind === "trailing") lines[at] = `${lines[at] ?? ""}  `;
      else if (kind === "long") lines.splice(at, 0, `// ${"keep the normalised value and the attempt count in sync ".repeat(3)}`);
      else if (kind === "mixed") {
        const indented = lines.findIndex((line) => line.startsWith("  "));
        if (indented >= 0) lines[indented] = `\t${lines[indented] ?? ""}`;
      } else if (kind === "debugger") lines.splice(at, 0, "  debugger;");
      else endsWithNewline = false;
    }
  }

  const body = lines.join("\n");
  return { path: `src/${noun}${index > 0 ? `-${index}` : ""}.ts`, content: endsWithNewline ? `${body}\n` : body.replace(/\n+$/, "") };
}

/** A small TypeScript "change set": `count` files, each a few thousand characters. */
export function sampleSourceFiles(rng: Rng, options: SampleFilesOptions): SourceFile[] {
  const pool = rng.shuffle(NOUNS);
  return Array.from({ length: options.count }, (_, i) => {
    const noun = pool[i % pool.length] ?? "invoice";
    return sourceFile(rng, noun, Math.floor(i / pool.length), options.dirtiness);
  });
}

/** JSON Schema for a feature spec. Uses only keywords the router's validator fully supports. */
export const SPEC_SCHEMA = {
  type: "object",
  required: ["id", "title", "priority", "acceptanceCriteria"],
  properties: {
    id: { type: "string", pattern: "^F-\\d+$" },
    title: { type: "string", minLength: 3 },
    priority: { enum: ["P0", "P1", "P2"] },
    acceptanceCriteria: { type: "array", minItems: 1, items: { type: "string", minLength: 5 } },
  },
  additionalProperties: false,
} as const;

const CRITERIA = [
  "Exports complete within five seconds for 10,000 rows",
  "Totals match the invoice ledger to the cent",
  "Admins can filter by team and date range",
  "Failed jobs are retried and surfaced in the audit log",
  "Access requires the billing:read permission",
  "Results are cached for 15 minutes per tenant",
] as const;

export type SpecFlaw = "none" | "syntax" | "schema";

export function sampleSpecJson(rng: Rng, featureId: string, title: string, flaw: SpecFlaw): string {
  const criteria = rng.shuffle(CRITERIA).slice(0, rng.int(2, 4));
  const doc = { id: featureId, title, priority: flaw === "schema" ? "P9" : rng.pick(["P0", "P1", "P2"] as const), acceptanceCriteria: criteria };
  const text = JSON.stringify(doc, null, 2);
  return flaw === "syntax" ? text.replace(/\n}$/, ",\n}") : text;
}

/** A compact, machine-written changelog whose keys are deliberately not in sorted order. */
export function sampleChangelogJson(rng: Rng, featureId: string): string {
  return JSON.stringify({
    version: `1.${rng.int(2, 9)}.${rng.int(0, 12)}`,
    featureId,
    changes: [`Add ${rng.pick(NOUNS)} ${rng.pick(["export", "filter", "summary", "alert"])}`, `Fix ${rng.pick(NOUNS)} rounding`],
    breaking: false,
    date: "2026-11-03",
  });
}

/** Output as printed by `vitest run`, in the shape the router's test summariser reads. */
export function sampleVitestOutput(rng: Rng, options: { files: number; tests: number; failed: number }): string {
  const { files, tests, failed } = options;
  const lines = ["", " RUN  v5.1.2 /work/app", ""];
  for (let i = 0; i < failed; i += 1) {
    const noun = rng.pick(NOUNS);
    lines.push(` FAIL  src/${noun}.test.ts > ${noun} > case ${i + 1}`, `AssertionError: expected ${rng.int(1, 9)} to be ${rng.int(10, 99)} // Object.is equality`, "");
  }
  const failedFiles = Math.min(failed, files);
  const join = (a: number, b: number): string => [a > 0 ? `${a} failed` : "", b > 0 ? `${b} passed` : ""].filter(Boolean).join(" | ");
  lines.push(
    ` Test Files  ${join(failedFiles, files - failedFiles)} (${files})`,
    `      Tests  ${join(failed, tests - failed)} (${tests})`,
    `   Duration  ${rng.range(0.6, 3.4).toFixed(2)}s`,
    "",
  );
  return lines.join("\n");
}
