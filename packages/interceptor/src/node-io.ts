import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CliIO } from "./cli";

async function jsonlFilesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await jsonlFilesUnder(full)));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(full);
  }
  return found;
}

/** Real filesystem / process I/O for the CLI. The only place (with `bin.ts`) that touches Node. */
export function createNodeIO(): CliIO {
  return {
    readText: (path) => readFile(path, "utf8"),
    expandPaths: async (paths) => {
      const expanded: string[] = [];
      for (const path of paths) {
        if ((await stat(path)).isDirectory()) expanded.push(...(await jsonlFilesUnder(path)).sort());
        else expanded.push(path);
      }
      return expanded;
    },
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
  };
}
