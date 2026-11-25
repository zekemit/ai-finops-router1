import { describe, expect, it } from "vitest";
import { findUnsupportedKeywords, validateJsonSchema } from "../src/scripts/json-schema";

const messages = (value: unknown, schema: unknown): string[] =>
  validateJsonSchema(value, schema).map((issue) => `${issue.path} ${issue.message}`);

describe("validateJsonSchema — supported keywords", () => {
  it("returns no issues for a conforming document", () => {
    const schema = {
      type: "object",
      required: ["name", "age"],
      properties: { name: { type: "string", minLength: 1 }, age: { type: "integer", minimum: 0 }, tags: { type: "array", items: { type: "string" } } },
      additionalProperties: false,
    };
    expect(validateJsonSchema({ name: "Ada", age: 36, tags: ["x"] }, schema)).toEqual([]);
  });

  it("checks types, distinguishing integer from number and null from object", () => {
    expect(messages("1", { type: "integer" })).toEqual(["/ expected integer, got string"]);
    expect(messages(1.5, { type: "integer" })).toEqual(["/ expected integer, got number"]);
    expect(messages(1, { type: "number" })).toEqual([]);
    expect(messages(null, { type: "object" })).toEqual(["/ expected object, got null"]);
    expect(messages([], { type: "object" })).toEqual(["/ expected object, got array"]);
    expect(messages(1, { type: ["string", "integer"] })).toEqual([]);
  });

  it("reports missing required properties and disallowed extras with JSON-pointer paths", () => {
    const schema = { type: "object", required: ["a"], properties: { a: { type: "string" } }, additionalProperties: false };
    expect(messages({ b: 1 }, schema)).toEqual(['/ missing required property "a"', '/b additional property "b" is not allowed']);
  });

  it("validates nested paths and array items", () => {
    const schema = { type: "object", properties: { users: { type: "array", items: { type: "object", required: ["id"] } } } };
    expect(messages({ users: [{ id: 1 }, {}] }, schema)).toEqual(['/users/1 missing required property "id"']);
  });

  it("checks enum and const", () => {
    expect(messages("c", { enum: ["a", "b"] })).toEqual(['/ must be one of ["a","b"]']);
    expect(messages("a", { enum: ["a", "b"] })).toEqual([]);
    expect(messages(2, { const: 1 })).toEqual(["/ must equal 1"]);
  });

  it("checks numeric, string and array bounds", () => {
    expect(messages(-1, { minimum: 0 })).toEqual(["/ must be >= 0"]);
    expect(messages(11, { maximum: 10 })).toEqual(["/ must be <= 10"]);
    expect(messages("ab", { minLength: 3 })).toEqual(["/ must have at least 3 characters"]);
    expect(messages("abcd", { maxLength: 3 })).toEqual(["/ must have at most 3 characters"]);
    expect(messages([1], { minItems: 2 })).toEqual(["/ must have at least 2 items"]);
    expect(messages([1, 2, 3], { maxItems: 2 })).toEqual(["/ must have at most 2 items"]);
  });

  it("checks patterns", () => {
    expect(messages("abc", { pattern: "^a" })).toEqual([]);
    expect(messages("xbc", { pattern: "^a" })).toEqual(['/ must match pattern "^a"']);
  });

  it("supports allOf / anyOf / oneOf", () => {
    expect(messages(5, { allOf: [{ type: "integer" }, { minimum: 10 }] })).toEqual(["/ must be >= 10"]);
    expect(messages("x", { anyOf: [{ type: "integer" }, { type: "boolean" }] })).toEqual(["/ must match at least one schema in anyOf"]);
    expect(messages(1, { oneOf: [{ type: "integer" }, { minimum: 0 }] })).toEqual(["/ must match exactly one schema in oneOf (matched 2)"]);
    expect(messages(1, { oneOf: [{ type: "integer" }, { type: "string" }] })).toEqual([]);
  });

  it("treats boolean schemas as always / never valid", () => {
    expect(messages(1, true)).toEqual([]);
    expect(messages(1, false)).toEqual(["/ no value is allowed here"]);
  });

  it("ignores annotation keywords", () => {
    expect(messages(1, { $schema: "http://json-schema.org/draft-07/schema#", title: "T", description: "d", default: 0, examples: [1], type: "integer" })).toEqual([]);
  });
});

describe("findUnsupportedKeywords — refuse to judge what we cannot evaluate", () => {
  it("returns nothing for a fully supported schema, including nested ones", () => {
    expect(findUnsupportedKeywords({ type: "object", properties: { a: { type: "array", items: { anyOf: [{ type: "string" }] } } } })).toEqual([]);
  });

  it.each([["$ref"], ["if"], ["not"], ["patternProperties"], ["format"], ["contains"], ["dependencies"], ["propertyNames"]])(
    "flags %s",
    (keyword) => {
      expect(findUnsupportedKeywords({ [keyword]: {} })).toEqual([keyword]);
    },
  );

  it("finds unsupported keywords at any depth and reports each once, with its location", () => {
    const found = findUnsupportedKeywords({ properties: { a: { $ref: "#/x" }, b: { items: { format: "email" } } } });
    expect(found).toEqual(["$ref", "format"]);
  });

  it("flags a pattern that could cause catastrophic backtracking", () => {
    expect(findUnsupportedKeywords({ pattern: "(a+)+$" })).toEqual(["pattern (unsafe regular expression)"]);
    expect(findUnsupportedKeywords({ pattern: "^a+b$" })).toEqual([]);
  });
});
