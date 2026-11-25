import { describe, expect, it } from "vitest";
import { summarize } from "../src/aggregate";
import { formatSummaryReport } from "../src/report";
import { makeEvent } from "./helpers";

describe("formatSummaryReport", () => {
  const events = [
    makeEvent({ agent: "PM_Agent", usage: { inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 9_000 } }),
    makeEvent({ agent: "Architect_Agent", model: "claude-opus-5-5", usage: { inputTokens: 2_000, outputTokens: 1_000, cacheWrite5mTokens: 8_000 } }),
  ];

  it("renders one row per subagent plus a TOTAL row", () => {
    const text = formatSummaryReport(summarize(events));
    for (const name of ["PM_Agent", "Architect_Agent", "Security_Agent", "Release_Agent", "TOTAL"]) {
      expect(text).toContain(name);
    }
    expect(text).toMatch(/PM_Agent\s+1\s+\$0\.0079\s+90\.0%/);
    expect(text).toMatch(/TOTAL\s+2\s+\$0\.0759/);
  });

  it("aligns columns: every table row has the same width", () => {
    const rows = formatSummaryReport(summarize(events))
      .split("\n")
      .filter((line) => /^(Agent|PM_Agent|Architect_Agent|Security_Agent|Release_Agent|TOTAL)\b/.test(line));
    expect(rows.length).toBe(6);
    expect(new Set(rows.map((r) => r.length)).size).toBe(1);
  });

  it("states overall cache savings in dollars and percent", () => {
    // baseline 0.085, billed 0.0759, savings 0.0091 = 10.7%
    expect(formatSummaryReport(summarize(events))).toContain("Cache savings: $0.0091 (10.7%)");
  });

  it("calls out models that could not be priced, so a total is never silently understated", () => {
    const text = formatSummaryReport(summarize([...events, makeEvent({ model: "gpt-4o", usage: { inputTokens: 5 } })]));
    expect(text).toContain("Unpriced models (excluded from $): gpt-4o (1 call)");
  });

  it("flags models priced with an assumed cache-read rate", () => {
    const text = formatSummaryReport(summarize([makeEvent({ model: "claude-haiku-4-5", usage: { inputTokens: 5 } })]));
    expect(text).toContain("Assumed cache-read pricing: claude-haiku-4-5");
  });

  it("shows cost per feature shipped only once a feature has shipped", () => {
    expect(formatSummaryReport(summarize(events))).not.toContain("Cost per feature shipped");
    const shipped = summarize([
      makeEvent({ usage: { outputTokens: 1_000_000 }, featureId: "f1", milestone: "feature_shipped" }),
    ]);
    expect(formatSummaryReport(shipped)).toContain("Cost per feature shipped: $10.00 (1 feature)");
  });
});
