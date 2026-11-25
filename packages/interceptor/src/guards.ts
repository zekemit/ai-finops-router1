export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns the string if it is a non-empty string, else undefined. */
export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
