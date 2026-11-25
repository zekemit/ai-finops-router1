import { describe, expect, it } from "vitest";
import { formatInt, formatMs, formatPct, formatUsd } from "../src/format";

describe("formatUsd", () => {
  it.each([
    [1234.5678, "$1,234.57"],
    [12, "$12.00"],
    [0.2346157, "$0.2346"],
    [0.0005, "$0.0005"],
    [0, "$0.00"],
    [-0.5, "-$0.50"],
  ])("formats %d as %s", (value, expected) => {
    expect(formatUsd(value)).toBe(expected);
  });

  it("never prints negative zero", () => {
    expect(formatUsd(-0)).toBe("$0.00");
  });
});

describe("formatPct", () => {
  it.each([
    [0.5274, "52.7%"],
    [1, "100.0%"],
    [0, "0.0%"],
    [-0.0501, "-5.0%"],
  ])("formats %d as %s", (value, expected) => {
    expect(formatPct(value)).toBe(expected);
  });
});

describe("formatInt", () => {
  it("groups thousands", () => {
    expect(formatInt(1_234_567)).toBe("1,234,567");
    expect(formatInt(0)).toBe("0");
  });
});

describe("formatMs", () => {
  it.each([
    [450, "450ms"],
    [1200, "1.2s"],
    [61_000, "61.0s"],
    [null, "—"],
  ])("formats %j as %s", (value, expected) => {
    expect(formatMs(value)).toBe(expected);
  });
});
