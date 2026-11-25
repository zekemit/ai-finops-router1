import { summarize } from "./aggregate";
import { detectRunawayLoops } from "./analytics";
import { formatInt, formatUsd } from "./format";
import { parseClaudeCodeJsonl } from "./jsonl-parser";
import { sortEvents } from "./parse-common";
import { parseApiPayloadText } from "./payload-parser";
import { formatSummaryReport } from "./report";
import type { ParseResult, ParseWarning, TelemetryEvent } from "./types";

/** All side effects the CLI needs, injected so the CLI itself is pure and testable in memory. */
export interface CliIO {
  readText(path: string): Promise<string>;
  /** Expand directories to the `.jsonl` files beneath them; pass plain files through. */
  expandPaths(paths: readonly string[]): Promise<string[]>;
  stdout(text: string): void;
  stderr(text: string): void;
}

type Format = "claude-code" | "payload";

const USAGE = `Usage: finops-parse [options] <path>...

Parse Claude Code session logs (or multi-agent API payloads) into per-agent cost, cache and latency telemetry.

Arguments:
  <path>            A .jsonl log file, or a directory (searched recursively for *.jsonl)

Options:
  --format <fmt>    claude-code (default) | payload  (JSON array or newline-delimited API payloads)
  --json            Emit a machine-readable JSON document instead of the text report
  -h, --help        Show this help

Exit codes: 0 ok, 1 no billed calls / unreadable input, 2 usage error`;

const MAX_WARNINGS_SHOWN = 20;

type ArgsResult =
  | { readonly kind: "run"; readonly format: Format; readonly json: boolean; readonly paths: readonly string[] }
  | { readonly kind: "help" }
  | { readonly kind: "error"; readonly message: string };

function isFormat(value: string): value is Format {
  return value === "claude-code" || value === "payload";
}

function parseArgs(argv: readonly string[]): ArgsResult {
  let format: Format = "claude-code";
  let json = false;
  const paths: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "-h" || arg === "--help") return { kind: "help" };
    if (arg === "--json") {
      json = true;
    } else if (arg === "--format" || arg.startsWith("--format=")) {
      const value = arg === "--format" ? argv[(i += 1)] : arg.slice("--format=".length);
      if (value === undefined || !isFormat(value)) {
        return { kind: "error", message: `invalid --format value ${JSON.stringify(value ?? "")} (expected claude-code or payload)` };
      }
      format = value;
    } else if (arg.startsWith("-")) {
      return { kind: "error", message: `unknown option ${JSON.stringify(arg)}` };
    } else {
      paths.push(arg);
    }
  }

  if (paths.length === 0) return { kind: "error", message: "no input path given" };
  return { kind: "run", format, json, paths };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `/a/b/session-1.jsonl` -> `session-1`; used as a session id when a log line carries none. */
function fileStem(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

interface FileWarning extends ParseWarning {
  readonly file: string;
}

export async function runCli(argv: readonly string[], io: CliIO): Promise<number> {
  const args = parseArgs(argv);
  if (args.kind === "help") {
    io.stdout(`${USAGE}\n`);
    return 0;
  }
  if (args.kind === "error") {
    io.stderr(`finops-parse: ${args.message}\n\n${USAGE}\n`);
    return 2;
  }

  let files: string[];
  try {
    files = await io.expandPaths(args.paths);
  } catch (error) {
    io.stderr(`finops-parse: ${errorMessage(error)}\n`);
    return 1;
  }
  if (files.length === 0) {
    io.stderr("finops-parse: no .jsonl files found\n");
    return 1;
  }

  const byId = new Map<string, TelemetryEvent>();
  const warnings: FileWarning[] = [];
  let recordsRead = 0;
  let duplicatesDropped = 0;

  for (const file of files) {
    let text: string;
    try {
      text = await io.readText(file);
    } catch (error) {
      io.stderr(`finops-parse: cannot read ${file}: ${errorMessage(error)}\n`);
      return 1;
    }
    const result: ParseResult =
      args.format === "payload" ? parseApiPayloadText(text) : parseClaudeCodeJsonl(text, { sessionId: fileStem(file) });
    recordsRead += result.stats.recordsRead;
    duplicatesDropped += result.stats.duplicatesDropped;
    for (const event of result.events) {
      if (byId.has(event.id)) duplicatesDropped += 1; // the same call logged in more than one file
      else byId.set(event.id, event);
    }
    for (const warning of result.warnings) warnings.push({ file, ...warning });
  }

  warnings.slice(0, MAX_WARNINGS_SHOWN).forEach((w) => io.stderr(`${w.file}:${w.line} ${w.code} ${w.message}\n`));
  if (warnings.length > MAX_WARNINGS_SHOWN) io.stderr(`... and ${warnings.length - MAX_WARNINGS_SHOWN} more warning(s)\n`);

  const events = sortEvents([...byId.values()]);
  if (events.length === 0) {
    io.stderr(`finops-parse: no billed calls found in ${files.length} file(s)\n`);
    return 1;
  }

  const summary = summarize(events);
  const loopAlerts = detectRunawayLoops(events);

  if (args.json) {
    const stats = { files: files.length, recordsRead, eventsParsed: events.length, duplicatesDropped };
    io.stdout(`${JSON.stringify({ summary, stats, warnings, loopAlerts }, null, 2)}\n`);
    return 0;
  }

  const lines = [
    `Parsed ${formatInt(events.length)} billed call(s) from ${formatInt(recordsRead)} record(s) in ${files.length} file(s); ` +
      `${formatInt(duplicatesDropped)} duplicate record(s) collapsed, ${formatInt(warnings.length)} warning(s).`,
    "",
    formatSummaryReport(summary),
  ];
  for (const alert of loopAlerts) {
    lines.push(
      "",
      `Runaway loop: ${alert.agent} repeated the same call ${alert.repeats} times in session ${alert.sessionId} ` +
        `(wasted ${formatUsd(alert.wastedCostUsd)}, ${formatInt(alert.wastedTokens)} tokens)`,
    );
  }
  io.stdout(`${lines.join("\n")}\n`);
  return 0;
}
