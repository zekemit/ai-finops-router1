/**
 * record-tests — run every workspace's test suite and write the results to `tests.json`.
 *
 * `tests.json` is generated state (never hand-edited): it lets a fresh or reconnected session see
 * exactly which suites passed at the last recorded run. Exits non-zero if any suite failed, but the
 * file is written either way so a failing state is recorded too.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

type Rec = Record<string, unknown>;

const ROOT = join(import.meta.dirname, "..");
const PHASE_OF: Readonly<Record<string, string>> = {
  "@ai-finops/interceptor": "phase2",
  "@ai-finops/router": "phase3",
  "@ai-finops/dashboard": "phase4",
};

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);

interface FileResult {
  readonly file: string;
  readonly status: "passed" | "failed";
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

interface PackageResult {
  readonly status: "passed" | "failed" | "no-tests";
  readonly phase: string | null;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly files: readonly FileResult[];
  readonly failures: readonly string[];
}

function workspaceDirs(): string[] {
  const dirs: string[] = [];
  for (const group of ["packages", "apps"]) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(base, entry.name, "package.json"))) dirs.push(join(base, entry.name));
    }
  }
  return dirs.sort();
}

function runSuite(dir: string, name: string): PackageResult {
  const outDir = mkdtempSync(join(tmpdir(), "record-tests-"));
  const outFile = join(outDir, "vitest.json");
  try {
    spawnSync("npx", ["vitest", "run", "--passWithNoTests", "--reporter=json", `--outputFile=${outFile}`], {
      cwd: dir,
      stdio: ["ignore", "ignore", "inherit"],
    });
    if (!existsSync(outFile)) {
      return { status: "failed", phase: PHASE_OF[name] ?? null, total: 0, passed: 0, failed: 1, skipped: 0, files: [], failures: ["vitest produced no report"] };
    }
    const report: unknown = JSON.parse(readFileSync(outFile, "utf8"));
    const files: FileResult[] = [];
    const failures: string[] = [];
    if (isRec(report)) {
      for (const suite of list(report["testResults"])) {
        if (!isRec(suite)) continue;
        const results = list(suite["assertionResults"]).filter(isRec);
        const passed = results.filter((r) => r["status"] === "passed").length;
        const failed = results.filter((r) => r["status"] === "failed").length;
        const skipped = results.length - passed - failed;
        const file = relative(dir, str(suite["name"]));
        for (const r of results) if (r["status"] === "failed") failures.push(`${file} > ${str(r["fullName"])}`);
        const suiteFailed = suite["status"] === "failed" || failed > 0;
        if (suiteFailed && failed === 0) failures.push(`${file} > suite failed to run: ${str(suite["message"]).slice(0, 200)}`);
        files.push({ file, status: suiteFailed ? "failed" : "passed", total: results.length, passed, failed, skipped });
      }
    }
    const total = files.reduce((n, f) => n + f.total, 0);
    const passed = files.reduce((n, f) => n + f.passed, 0);
    const failed = files.reduce((n, f) => n + f.failed, 0) + failures.filter((f) => f.includes("suite failed to run")).length;
    const skipped = files.reduce((n, f) => n + f.skipped, 0);
    const status = files.length === 0 ? "no-tests" : failures.length > 0 ? "failed" : "passed";
    return { status, phase: PHASE_OF[name] ?? null, total, passed, failed, skipped, files, failures };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

function main(): number {
  const packages: Record<string, PackageResult> = {};
  for (const dir of workspaceDirs()) {
    const pkg: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const name = isRec(pkg) ? str(pkg["name"]) : "";
    if (name === "") continue;
    packages[name] = runSuite(dir, name);
    const r = packages[name];
    if (r !== undefined) console.log(`${name}: ${r.status} (${r.passed}/${r.total} passed, ${r.failed} failed, ${r.skipped} skipped)`);
  }

  const all = Object.values(packages);
  const summary = {
    total: all.reduce((n, p) => n + p.total, 0),
    passed: all.reduce((n, p) => n + p.passed, 0),
    failed: all.reduce((n, p) => n + p.failed, 0),
    skipped: all.reduce((n, p) => n + p.skipped, 0),
  };
  const document = {
    generatedBy: "npm run record-tests",
    generatedAt: new Date().toISOString(),
    summary,
    packages,
  };
  writeFileSync(join(ROOT, "tests.json"), `${JSON.stringify(document, null, 2)}\n`);
  console.log(`tests.json written: ${summary.passed}/${summary.total} passed, ${summary.failed} failed`);
  return all.some((p) => p.status === "failed") ? 1 : 0;
}

process.exitCode = main();
