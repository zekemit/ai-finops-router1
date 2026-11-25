/**
 * 32-bit FNV-1a over UTF-16 code units, as 8 lowercase hex chars.
 * Not cryptographic: used only to fingerprint requests for loop detection, and
 * implemented inline so the library core needs no `node:crypto` (it also runs in the browser).
 */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** JSON serialisation with object keys sorted, so semantically equal inputs hash equally. */
export function stableStringify(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
