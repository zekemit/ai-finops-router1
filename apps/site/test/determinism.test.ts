import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");
const read = (relative: string): string => readFileSync(join(SRC, relative), "utf8");

/** The model and the simulation render on the server and again in the browser: any engine-dependent behaviour is a hydration mismatch. */
const PURE = ["lib/roi.ts", "lib/logstream.ts", "lib/stream-engine.ts", "lib/rng.ts"];

describe("the model and the simulation are portable across JavaScript engines", () => {
  it.each(PURE)("%s never reads the clock or Math.random", (file) => {
    expect(read(file)).not.toMatch(/Math\.random|Date\.now|new Date\(\)|performance\.now/);
  });

  it.each(PURE)("%s never shuffles with a random sort comparator", (file) => {
    expect(read(file)).not.toMatch(/\.sort\(\s*\(\s*\)\s*=>/);
    expect(read(file)).not.toMatch(/\.sort\([^)]*(rng|random)/i);
  });
});

describe("architecture rules", () => {
  const files = (dir: string): string[] =>
    readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : []));
  const all = files(".");

  it("finds the source it is meant to police", () => {
    expect(all.length).toBeGreaterThan(15);
  });

  it("uses no `any`, ts-ignore or ts-expect-error", () => {
    expect(all.filter((f) => /\bas any\b|:\s*any\b|<any>|\bany\[\]|@ts-ignore|@ts-expect-error/.test(read(f)))).toEqual([]);
  });

  it("has no TODO placeholders", () => {
    expect(all.filter((f) => /\bTODO\b|\bFIXME\b/.test(read(f)))).toEqual([]);
  });

  it("reaches the workspace packages only through their public entry points, and never imports another app", () => {
    // Look at import specifiers only: the words "apps/dashboard" legitimately appear in on-page text.
    const specifiers = (source: string): string[] => [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");
    const forbidden = /^@ai-finops\/(interceptor|router)\/|packages\/|apps\/|^@ai-finops\/dashboard|^@ai-finops\/site/;
    expect(all.filter((f) => specifiers(read(f)).some((spec) => forbidden.test(spec)))).toEqual([]);
  });

  it("does import the workspace packages through their package names", () => {
    const names = new Set(all.flatMap((f) => [...read(f).matchAll(/\bfrom\s+["'](@ai-finops\/[^"']+)["']/g)].map((m) => m[1])));
    expect([...names].sort()).toEqual(["@ai-finops/interceptor", "@ai-finops/router"]);
  });

  it("keeps filesystem access out of client components: only the server-side loader may import repo-facts at runtime", () => {
    const offenders = all.filter((f) => f.startsWith("components") && /import\s+(?!type\b)[^;]*from\s+["'][^"']*repo-facts["']/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
