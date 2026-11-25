/**
 * JSON formatter that preserves the document exactly.
 *
 * `JSON.parse` + `JSON.stringify` is NOT safe for formatting: it rewrites 12345678901234567890 as
 * 12345678901234567000, 1.0 as 1, 1e3 as 1000, and silently drops duplicate keys. This module parses to
 * a syntax tree that keeps each number and string literal verbatim, then re-prints it. It also gives
 * exact line/column errors with messages that do not vary between Node versions.
 */

export interface JsonFormatOptions {
  readonly mode: "pretty" | "minify";
  /** Spaces per level in pretty mode (clamped to 0-8; 0 prints compactly). */
  readonly indent: number;
  /** Sort object keys recursively (by decoded key). */
  readonly sortKeys: boolean;
}

export interface JsonParseError {
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

export type JsonFormatResult =
  | { readonly ok: true; readonly formatted: string }
  | { readonly ok: false; readonly error: JsonParseError };

interface Member {
  /** The key exactly as written, quotes included. */
  readonly raw: string;
  /** The decoded key, used for sorting. */
  readonly key: string;
  readonly value: JsonNode;
}
type JsonNode =
  | { readonly kind: "object"; readonly members: readonly Member[] }
  | { readonly kind: "array"; readonly items: readonly JsonNode[] }
  | { readonly kind: "scalar"; readonly raw: string };

const MAX_DEPTH = 512;

class JsonSyntaxError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

class Parser {
  private pos = 0;

  constructor(private readonly text: string) {}

  parseDocument(): JsonNode {
    this.skipWhitespace();
    if (this.pos >= this.text.length) throw new JsonSyntaxError("Unexpected end of JSON input", this.pos);
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.pos < this.text.length) {
      throw new JsonSyntaxError(`Unexpected character ${this.quote()} after the end of the JSON value`, this.pos);
    }
    return value;
  }

  private quote(): string {
    return JSON.stringify(this.text[this.pos] ?? "");
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length) {
      const c = this.text[this.pos];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") this.pos += 1;
      else break;
    }
  }

  private parseValue(depth: number): JsonNode {
    if (depth > MAX_DEPTH) throw new JsonSyntaxError(`JSON is nested too deeply (limit ${MAX_DEPTH})`, this.pos);
    const c = this.text[this.pos];
    if (c === undefined) throw new JsonSyntaxError("Unexpected end of JSON input", this.pos);
    if (c === "{") return this.parseObject(depth);
    if (c === "[") return this.parseArray(depth);
    if (c === '"') return { kind: "scalar", raw: this.parseString() };
    if (c === "-" || (c >= "0" && c <= "9")) return { kind: "scalar", raw: this.parseNumber() };
    for (const literal of ["true", "false", "null"]) {
      if (this.text.startsWith(literal, this.pos)) {
        this.pos += literal.length;
        return { kind: "scalar", raw: literal };
      }
    }
    throw new JsonSyntaxError(`Unexpected character ${this.quote()}; expected a JSON value`, this.pos);
  }

  private parseObject(depth: number): JsonNode {
    this.pos += 1; // {
    const members: Member[] = [];
    this.skipWhitespace();
    if (this.text[this.pos] === "}") {
      this.pos += 1;
      return { kind: "object", members };
    }
    for (;;) {
      this.skipWhitespace();
      if (this.pos >= this.text.length) throw new JsonSyntaxError("Unexpected end of JSON input", this.pos);
      if (this.text[this.pos] !== '"') {
        throw new JsonSyntaxError(`Unexpected character ${this.quote()}; expected a property name`, this.pos);
      }
      const raw = this.parseString();
      this.skipWhitespace();
      if (this.text[this.pos] !== ":") {
        if (this.pos >= this.text.length) throw new JsonSyntaxError("Unexpected end of JSON input", this.pos);
        throw new JsonSyntaxError(`Unexpected character ${this.quote()}; expected ":"`, this.pos);
      }
      this.pos += 1;
      this.skipWhitespace();
      const value = this.parseValue(depth + 1);
      members.push({ raw, key: JSON.parse(raw) as string, value });
      this.skipWhitespace();
      const c = this.text[this.pos];
      if (c === ",") {
        this.pos += 1;
        continue;
      }
      if (c === "}") {
        this.pos += 1;
        return { kind: "object", members };
      }
      if (c === undefined) throw new JsonSyntaxError("Unexpected end of JSON input", this.pos);
      throw new JsonSyntaxError(`Unexpected character ${this.quote()}; expected "," or "}"`, this.pos);
    }
  }

  private parseArray(depth: number): JsonNode {
    this.pos += 1; // [
    const items: JsonNode[] = [];
    this.skipWhitespace();
    if (this.text[this.pos] === "]") {
      this.pos += 1;
      return { kind: "array", items };
    }
    for (;;) {
      this.skipWhitespace();
      items.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      const c = this.text[this.pos];
      if (c === ",") {
        this.pos += 1;
        continue;
      }
      if (c === "]") {
        this.pos += 1;
        return { kind: "array", items };
      }
      if (c === undefined) throw new JsonSyntaxError("Unexpected end of JSON input", this.pos);
      throw new JsonSyntaxError(`Unexpected character ${this.quote()}; expected "," or "]"`, this.pos);
    }
  }

  private parseString(): string {
    const start = this.pos;
    this.pos += 1; // opening quote
    for (;;) {
      const c = this.text[this.pos];
      if (c === undefined) throw new JsonSyntaxError("Unterminated string", start);
      if (c === '"') {
        this.pos += 1;
        return this.text.slice(start, this.pos);
      }
      if (c < " ") throw new JsonSyntaxError("Invalid control character in string", this.pos);
      if (c === "\\") {
        const e = this.text[this.pos + 1];
        if (e !== undefined && '"\\/bfnrt'.includes(e)) {
          this.pos += 2;
        } else if (e === "u" && /^[0-9a-fA-F]{4}$/.test(this.text.slice(this.pos + 2, this.pos + 6))) {
          this.pos += 6;
        } else {
          throw new JsonSyntaxError("Invalid escape sequence in string", this.pos);
        }
      } else {
        this.pos += 1;
      }
    }
  }

  private parseNumber(): string {
    const start = this.pos;
    const digit = (i: number): boolean => {
      const c = this.text[i];
      return c !== undefined && c >= "0" && c <= "9";
    };
    if (this.text[this.pos] === "-") this.pos += 1;
    if (this.text[this.pos] === "0") {
      this.pos += 1;
    } else if (digit(this.pos)) {
      while (digit(this.pos)) this.pos += 1;
    } else {
      throw new JsonSyntaxError("Invalid number: expected a digit", this.pos);
    }
    if (this.text[this.pos] === ".") {
      this.pos += 1;
      if (!digit(this.pos)) throw new JsonSyntaxError("Invalid number: expected a digit after the decimal point", this.pos);
      while (digit(this.pos)) this.pos += 1;
    }
    if (this.text[this.pos] === "e" || this.text[this.pos] === "E") {
      this.pos += 1;
      if (this.text[this.pos] === "+" || this.text[this.pos] === "-") this.pos += 1;
      if (!digit(this.pos)) throw new JsonSyntaxError("Invalid number: expected a digit in the exponent", this.pos);
      while (digit(this.pos)) this.pos += 1;
    }
    return this.text.slice(start, this.pos);
  }
}

function locate(text: string, offset: number): { line: number; column: number } {
  const clamped = Math.min(offset, text.length);
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: clamped - lineStart + 1 };
}

function print(node: JsonNode, indent: string, sortKeys: boolean, depth: number): string {
  if (node.kind === "scalar") return node.raw;
  const pretty = indent !== "";
  const pad = (level: number): string => indent.repeat(level);

  if (node.kind === "array") {
    if (node.items.length === 0) return "[]";
    const rendered = node.items.map((item) => print(item, indent, sortKeys, depth + 1));
    return pretty
      ? `[\n${rendered.map((r) => pad(depth + 1) + r).join(",\n")}\n${pad(depth)}]`
      : `[${rendered.join(",")}]`;
  }

  if (node.members.length === 0) return "{}";
  const members = sortKeys
    ? [...node.members].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    : node.members;
  const rendered = members.map((m) => `${m.raw}${pretty ? ": " : ":"}${print(m.value, indent, sortKeys, depth + 1)}`);
  return pretty
    ? `{\n${rendered.map((r) => pad(depth + 1) + r).join(",\n")}\n${pad(depth)}}`
    : `{${rendered.join(",")}}`;
}

/** Validate and re-print a JSON document without altering any value. */
export function formatJson(text: string, options: JsonFormatOptions): JsonFormatResult {
  let tree: JsonNode;
  try {
    tree = new Parser(text).parseDocument();
  } catch (error) {
    if (!(error instanceof JsonSyntaxError)) throw error;
    const { line, column } = locate(text, error.offset);
    return { ok: false, error: { message: `${error.message} at line ${line}, column ${column}`, line, column, offset: error.offset } };
  }
  const width = Math.min(8, Math.max(0, Math.trunc(options.indent)));
  const indent = options.mode === "pretty" ? " ".repeat(width) : "";
  return { ok: true, formatted: print(tree, indent, options.sortKeys, 0) };
}
