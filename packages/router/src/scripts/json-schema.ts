/**
 * A deliberately small JSON Schema validator (draft-07 subset). It validates what it fully
 * understands and tells the router what it does not (`findUnsupportedKeywords`), so a schema that
 * needs `$ref`, `if/then`, `format`, ... falls back to the LLM instead of being judged wrongly.
 */
import { compilePattern, isSafePattern } from "./regex";

export interface SchemaIssue {
  /** JSON Pointer; the root is "/". */
  readonly path: string;
  readonly message: string;
}

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);

const VALIDATING = new Set([
  "type",
  "enum",
  "const",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "anyOf",
  "oneOf",
  "allOf",
]);
const ANNOTATIONS = new Set(["$schema", "$id", "title", "description", "default", "examples"]);

function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "string":
    case "boolean":
      return typeof value === type;
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return isObj(value);
    default:
      return false;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ak = Object.keys(a);
    return ak.length === Object.keys(b).length && ak.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

const pointer = (base: string, segment: string | number): string => {
  const escaped = String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
  return base === "/" ? `/${escaped}` : `${base}/${escaped}`;
};

function validate(value: unknown, schema: unknown, path: string, out: SchemaIssue[]): void {
  if (schema === true) return;
  if (schema === false) {
    out.push({ path, message: "no value is allowed here" });
    return;
  }
  if (!isObj(schema)) return;
  const add = (message: string): void => {
    out.push({ path, message });
  };

  const type = schema["type"];
  if (typeof type === "string" || Array.isArray(type)) {
    const types = (Array.isArray(type) ? type : [type]).filter((t): t is string => typeof t === "string");
    if (!types.some((t) => matchesType(value, t))) add(`expected ${types.join(" or ")}, got ${kindOf(value)}`);
  }

  const enumValues = schema["enum"];
  if (Array.isArray(enumValues) && !enumValues.some((candidate) => deepEqual(candidate, value))) {
    add(`must be one of ${JSON.stringify(enumValues)}`);
  }
  if (Object.hasOwn(schema, "const") && !deepEqual(schema["const"], value)) add(`must equal ${JSON.stringify(schema["const"])}`);

  if (typeof value === "number") {
    const { minimum, maximum } = schema;
    if (typeof minimum === "number" && value < minimum) add(`must be >= ${minimum}`);
    if (typeof maximum === "number" && value > maximum) add(`must be <= ${maximum}`);
  }

  if (typeof value === "string") {
    const length = [...value].length;
    const { minLength, maxLength, pattern } = schema;
    if (typeof minLength === "number" && length < minLength) add(`must have at least ${minLength} characters`);
    if (typeof maxLength === "number" && length > maxLength) add(`must have at most ${maxLength} characters`);
    if (typeof pattern === "string") {
      const compiled = compilePattern(pattern, { regex: true, caseInsensitive: false });
      if (!compiled.ok) add(`pattern ${JSON.stringify(pattern)} could not be evaluated`);
      else if (!compiled.regex.test(value)) add(`must match pattern ${JSON.stringify(pattern)}`);
    }
  }

  if (Array.isArray(value)) {
    const { minItems, maxItems, items } = schema;
    if (typeof minItems === "number" && value.length < minItems) add(`must have at least ${minItems} items`);
    if (typeof maxItems === "number" && value.length > maxItems) add(`must have at most ${maxItems} items`);
    if (items !== undefined && !Array.isArray(items)) value.forEach((item, i) => validate(item, items, pointer(path, i), out));
  }

  if (isObj(value)) {
    const required = schema["required"];
    if (Array.isArray(required)) {
      for (const name of required) {
        if (typeof name === "string" && !Object.hasOwn(value, name)) add(`missing required property ${JSON.stringify(name)}`);
      }
    }
    const properties = isObj(schema["properties"]) ? schema["properties"] : {};
    for (const [name, sub] of Object.entries(properties)) {
      if (Object.hasOwn(value, name)) validate(value[name], sub, pointer(path, name), out);
    }
    const additional = schema["additionalProperties"];
    if (additional !== undefined) {
      for (const name of Object.keys(value)) {
        if (Object.hasOwn(properties, name)) continue;
        if (additional === false) out.push({ path: pointer(path, name), message: `additional property ${JSON.stringify(name)} is not allowed` });
        else validate(value[name], additional, pointer(path, name), out);
      }
    }
  }

  const valid = (sub: unknown): boolean => {
    const scratch: SchemaIssue[] = [];
    validate(value, sub, path, scratch);
    return scratch.length === 0;
  };
  const allOf = schema["allOf"];
  if (Array.isArray(allOf)) for (const sub of allOf) validate(value, sub, path, out);
  const anyOf = schema["anyOf"];
  if (Array.isArray(anyOf) && !anyOf.some(valid)) add("must match at least one schema in anyOf");
  const oneOf = schema["oneOf"];
  if (Array.isArray(oneOf)) {
    const matched = oneOf.filter(valid).length;
    if (matched !== 1) add(`must match exactly one schema in oneOf (matched ${matched})`);
  }
}

/** All issues, in a stable order (type, enum/const, bounds, required, properties, additional, combinators). */
export function validateJsonSchema(value: unknown, schema: unknown): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  validate(value, schema, "/", issues);
  return issues;
}

/**
 * Keywords in `schema` (at any depth) this validator cannot evaluate, each reported once.
 * An empty result means a "valid" verdict can be trusted.
 */
export function findUnsupportedKeywords(schema: unknown): string[] {
  const found: string[] = [];
  const note = (keyword: string): void => {
    if (!found.includes(keyword)) found.push(keyword);
  };
  const walk = (node: unknown): void => {
    if (typeof node === "boolean") return;
    if (!isObj(node)) {
      note("invalid schema");
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (ANNOTATIONS.has(key)) continue;
      if (!VALIDATING.has(key)) {
        note(key);
        continue;
      }
      if (key === "pattern" && typeof value === "string" && !isSafePattern(value)) note("pattern (unsafe regular expression)");
      if (key === "properties" && isObj(value)) Object.values(value).forEach(walk);
      if (key === "additionalProperties" && value !== undefined && typeof value !== "boolean") walk(value);
      if (key === "items") {
        if (Array.isArray(value)) note("items (tuple form)");
        else walk(value);
      }
      if ((key === "anyOf" || key === "oneOf" || key === "allOf") && Array.isArray(value)) value.forEach(walk);
    }
  };
  walk(schema);
  return found;
}
