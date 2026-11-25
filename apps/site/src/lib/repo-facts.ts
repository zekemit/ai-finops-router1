/**
 * Facts about this repository, read at build time from the `tests.json` that `npm run record-tests` generates.
 * Server-side only: client components must receive the result as props and never import this module at runtime.
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { DEFAULT_PRICING } from "@ai-finops/interceptor";
import { RULE_IDS } from "@ai-finops/router";

export class RepoFactsError extends Error {}

export interface PackageFacts {
  readonly name: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
}

export interface RepoFactsCore {
  readonly generatedAt: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly files: number;
  readonly packages: readonly PackageFacts[];
}

export interface RepoFacts extends RepoFactsCore {
  readonly models: number;
  readonly rules: number;
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);

function count(source: Obj, key: string, where: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new RepoFactsError(`${where}.${key} must be a non-negative integer, received ${JSON.stringify(value)}`);
  }
  return value;
}

export function parseRepoFacts(json: unknown): RepoFactsCore {
  if (!isObj(json)) throw new RepoFactsError("tests.json must be a JSON object");
  const summary = json["summary"];
  if (!isObj(summary)) throw new RepoFactsError("tests.json has no summary object");
  const total = count(summary, "total", "summary");
  const passed = count(summary, "passed", "summary");
  const failed = count(summary, "failed", "summary");
  if (passed > total) throw new RepoFactsError(`summary.passed (${passed}) exceeds summary.total (${total})`);

  const rawPackages = json["packages"];
  if (!isObj(rawPackages)) throw new RepoFactsError("tests.json has no packages object");
  let files = 0;
  const packages = Object.entries(rawPackages).map(([name, value]): PackageFacts => {
    if (!isObj(value)) throw new RepoFactsError(`packages.${name} must be an object`);
    const where = `packages.${name}`;
    if (!Array.isArray(value["files"])) throw new RepoFactsError(`${where}.files must be an array`);
    files += value["files"].length;
    return { name, total: count(value, "total", where), passed: count(value, "passed", where), failed: count(value, "failed", where) };
  });
  const generatedAt = json["generatedAt"];
  if (typeof generatedAt !== "string") throw new RepoFactsError("tests.json has no generatedAt string");
  return { generatedAt, total, passed, failed, files, packages };
}

async function findTestsJson(): Promise<string> {
  let dir = process.cwd();
  for (let level = 0; level < 6; level += 1) {
    const candidate = join(dir, "tests.json");
    try {
      return await readFile(candidate, "utf8");
    } catch {
      dir = dirname(dir);
    }
  }
  throw new RepoFactsError(`tests.json not found in ${process.cwd()} or any of its six parent directories`);
}

export async function loadRepoFacts(): Promise<RepoFacts> {
  const text = await findTestsJson();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new RepoFactsError("tests.json is not valid JSON");
  }
  return { ...parseRepoFacts(json), models: Object.keys(DEFAULT_PRICING).length, rules: RULE_IDS.length };
}
