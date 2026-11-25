import type { SourceFile } from "../types";

export interface GrepMatch {
  readonly path: string;
  /** 1-based. */
  readonly line: number;
  /** 1-based column of the first match on the line. */
  readonly column: number;
  readonly text: string;
}

export interface GrepResult {
  readonly matches: readonly GrepMatch[];
  /** Matching lines across all files (a line counts once however often it matches). */
  readonly totalMatches: number;
  readonly filesWithMatches: number;
  /** True when more lines matched than `maxMatches` returned. */
  readonly truncated: boolean;
}

export interface GrepOptions {
  /** Cap on returned matches (the total is still counted in full). Default 200. */
  readonly maxMatches?: number;
}

const MAX_LINE_TEXT = 200;

/** grep-style, line-oriented search. `regex` must be non-global (see `compilePattern`). */
export function grepFiles(files: readonly SourceFile[], regex: RegExp, options: GrepOptions = {}): GrepResult {
  const maxMatches = options.maxMatches ?? 200;
  const matches: GrepMatch[] = [];
  let totalMatches = 0;
  let filesWithMatches = 0;

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    if (lines[lines.length - 1] === "") lines.pop(); // phantom line after a trailing newline
    let fileHasMatch = false;
    lines.forEach((text, index) => {
      const found = regex.exec(text);
      if (found === null) return;
      fileHasMatch = true;
      totalMatches += 1;
      if (matches.length < maxMatches) {
        matches.push({ path: file.path, line: index + 1, column: found.index + 1, text: text.slice(0, MAX_LINE_TEXT) });
      }
    });
    if (fileHasMatch) filesWithMatches += 1;
  }

  return { matches, totalMatches, filesWithMatches, truncated: totalMatches > matches.length };
}
