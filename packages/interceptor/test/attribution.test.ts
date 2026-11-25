import { describe, expect, it } from "vitest";
import { normalizeAgentName } from "../src/attribution";

describe("normalizeAgentName", () => {
  it.each([
    ["PM_Agent", "PM_Agent"],
    ["pm-agent", "PM_Agent"],
    ["PM Agent", "PM_Agent"],
    ["pm", "PM_Agent"],
    ["Architect_Agent", "Architect_Agent"],
    ["architect", "Architect_Agent"],
    ["SECURITY_AGENT", "Security_Agent"],
    ["security", "Security_Agent"],
    ["release-agent", "Release_Agent"],
    ["release", "Release_Agent"],
  ])("maps %s to %s", (raw, expected) => {
    expect(normalizeAgentName(raw)).toBe(expected);
  });

  it.each([["general-purpose"], [""], ["pm_agent_2"], [42], [null], [undefined], [{}]])(
    "returns undefined for %j so unknown agents are never silently re-labelled",
    (raw) => {
      expect(normalizeAgentName(raw)).toBeUndefined();
    },
  );
});
