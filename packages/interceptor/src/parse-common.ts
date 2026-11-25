import type { ParseStats, TelemetryEvent } from "./types";

/** Milliseconds since epoch for a parseable timestamp string, else undefined. */
export function parseTimestamp(raw: unknown): number | undefined {
  if (typeof raw !== "string") return undefined;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Stable sort by completion time; ties keep ingestion order. */
export function sortEvents(events: readonly TelemetryEvent[]): TelemetryEvent[] {
  return events
    .map((event, index) => ({ event, index, ms: Date.parse(event.timestamp) }))
    .sort((a, b) => a.ms - b.ms || a.index - b.index)
    .map(({ event }) => event);
}

export function makeStats(
  recordsRead: number,
  eventsParsed: number,
  duplicatesDropped: number,
  ignored: number,
): ParseStats {
  return { recordsRead, eventsParsed, duplicatesDropped, ignored };
}
