import { describe, expect, it } from "vitest";
import { formatJson } from "../src/scripts/json";
import type { JsonFormatOptions } from "../src/scripts/json";

const pretty: JsonFormatOptions = { mode: "pretty", indent: 2, sortKeys: false };
const minify: JsonFormatOptions = { mode: "minify", indent: 2, sortKeys: false };

function ok(text: string, options: JsonFormatOptions): string {
  const result = formatJson(text, options);
  if (!result.ok) throw new Error(`expected valid JSON, got: ${result.error.message}`);
  return result.formatted;
}

describe("formatJson — layout", () => {
  it("pretty-prints with the configured indent", () => {
    expect(ok('{"b":1,"a":[1,2]}', pretty)).toBe('{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(ok('{"a":[1]}', { ...pretty, indent: 4 })).toBe('{\n    "a": [\n        1\n    ]\n}');
  });

  it("minifies by removing all insignificant whitespace", () => {
    expect(ok('{ "a" : 1 ,\n "b": [ 1, 2 ] }', minify)).toBe('{"a":1,"b":[1,2]}');
  });

  it("renders empty containers compactly", () => {
    expect(ok('{"a":{},"b":[]}', pretty)).toBe('{\n  "a": {},\n  "b": []\n}');
  });

  it("matches JSON.stringify's own layout for ordinary data", () => {
    const samples: unknown[] = [
      { name: "x", tags: ["a", "b"], nested: { n: null, ok: true, list: [{ a: 1 }, { b: [] }] } },
      [1, "two", [3, [4]], {}],
      "just a string",
      42,
      null,
    ];
    for (const sample of samples) {
      expect(ok(JSON.stringify(sample), pretty)).toBe(JSON.stringify(sample, null, 2));
      expect(ok(JSON.stringify(sample, null, 3), minify)).toBe(JSON.stringify(sample));
    }
  });

  it("sorts object keys recursively by decoded key when asked", () => {
    expect(ok('{"b":{"d":1,"c":2},"a":0}', { ...minify, sortKeys: true })).toBe('{"a":0,"b":{"c":2,"d":1}}');
  });
});

describe("formatJson — never alters the data", () => {
  it("preserves number literals exactly (no precision loss, no rewriting of 1.0 or 1e3)", () => {
    // JSON.parse + JSON.stringify would turn these into 12345678901234567000, 1 and 1000.
    expect(ok('{"id": 12345678901234567890, "x": 1.0, "y": 1e3, "z": -0}', minify)).toBe(
      '{"id":12345678901234567890,"x":1.0,"y":1e3,"z":-0}',
    );
  });

  it("preserves duplicate keys", () => {
    expect(ok('{"a":1,"a":2}', minify)).toBe('{"a":1,"a":2}');
  });

  it("preserves string escapes exactly as written", () => {
    expect(ok('{"k":"\\u00e9\\n\\/"}', minify)).toBe('{"k":"\\u00e9\\n\\/"}');
  });

  it("accepts every JSON value type at the top level", () => {
    for (const text of ["null", "  true ", '"x"', "-0", "1.5e+3", "[]", "{}"]) {
      expect(ok(text, minify)).toBe(text.trim());
    }
  });
});

describe("formatJson — errors carry an exact position and a Node-version-independent message", () => {
  function fail(text: string) {
    const result = formatJson(text, pretty);
    if (result.ok) throw new Error("expected invalid JSON");
    return result.error;
  }

  it("locates a trailing comma at the closing brace", () => {
    const error = fail('{\n  "a": 1,\n}');
    expect(error.line).toBe(3);
    expect(error.column).toBe(1);
    expect(error.message).toContain('"}"');
  });

  it("rejects single-quoted strings at the quote", () => {
    const error = fail("{'a':1}");
    expect([error.line, error.column]).toEqual([1, 2]);
  });

  it("reports an unterminated string", () => {
    expect(fail('{"a": "x').message).toContain("Unterminated string");
  });

  it("reports empty input", () => {
    for (const text of ["", "  \n "]) expect(fail(text).message).toContain("Unexpected end of JSON input");
  });

  it("rejects leading zeros at the second digit", () => {
    const error = fail("01");
    expect([error.line, error.column]).toEqual([1, 2]);
  });

  it("rejects raw control characters inside strings", () => {
    const error = fail('"a\nb"');
    expect(error.message).toContain("control character");
    expect([error.line, error.column]).toEqual([1, 3]);
  });

  it("rejects invalid escapes", () => {
    expect(fail('"\\q"').message).toContain("Invalid escape");
  });

  it("rejects trailing content after the value", () => {
    expect(fail('{"a":1} x').message).toContain("after the end of the JSON value");
  });

  it("refuses absurd nesting instead of overflowing the stack", () => {
    expect(fail("[".repeat(600) + "]".repeat(600)).message).toContain("nested too deeply");
  });

  it("counts lines across CRLF and LF consistently", () => {
    expect(fail('{\r\n  "a": 1,\r\n}').line).toBe(3);
  });
});
