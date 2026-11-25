import { describe, expect, it } from "vitest";
import { SAMPLE_CALL, overcount } from "../src/lib/sample";

describe("the overcount demo call", () => {
  it("is the real-log-shaped Sonnet 5.5 call priced by the interceptor: $0.2346157", () => {
    // 2 input, 800 output, 61,517 cache read, 55,115 one-hour cache write (the shape seen in a real Claude Code log)
    expect(SAMPLE_CALL.usd).toBeCloseTo(0.2346157, 10);
    expect(SAMPLE_CALL.usage).toMatchObject({ inputTokens: 2, outputTokens: 800, cacheReadTokens: 61_517, cacheWrite1hTokens: 55_115 });
  });

  it("overstates spend by exactly the number of lines logged for the call", () => {
    for (const blocks of [1, 2, 3, 6]) {
      const o = overcount(blocks);
      expect(o.correctUsd).toBeCloseTo(SAMPLE_CALL.usd, 12);
      expect(o.summedUsd).toBeCloseTo(SAMPLE_CALL.usd * blocks, 12);
      expect(o.factor).toBe(blocks);
    }
  });

  it("rejects a block count below one or a fraction", () => {
    expect(() => overcount(0)).toThrow(RangeError);
    expect(() => overcount(1.5)).toThrow(RangeError);
  });
});
