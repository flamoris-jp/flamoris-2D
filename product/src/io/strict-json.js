export function parseStrictJson(text) {
  if (typeof text !== "string") throw new TypeError("JSON input must be text.");
  let cursor = 0;

  const fail = (message) => {
    throw new SyntaxError(`${message} at character ${cursor}.`);
  };
  const whitespace = () => {
    while ([" ", "\t", "\n", "\r"].includes(text[cursor])) cursor += 1;
  };
  const string = () => {
    const start = cursor;
    if (text[cursor++] !== '"') fail("Expected a string");
    let escaped = false;
    while (cursor < text.length) {
      const character = text[cursor++];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"') {
        try { return JSON.parse(text.slice(start, cursor)); }
        catch { fail("Invalid JSON string"); }
      }
      if (character.charCodeAt(0) < 0x20) fail("Unescaped control character");
    }
    fail("Unterminated JSON string");
  };
  const value = () => {
    whitespace();
    const character = text[cursor];
    if (character === '"') return string();
    if (character === "{") return object();
    if (character === "[") return array();
    for (const [token, result] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(token, cursor)) {
        cursor += token.length;
        return result;
      }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(cursor));
    if (!match) fail("Expected a JSON value");
    cursor += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) fail("JSON number is out of range");
    return number;
  };
  const array = () => {
    cursor += 1;
    const result = [];
    whitespace();
    if (text[cursor] === "]") {
      cursor += 1;
      return result;
    }
    while (true) {
      result.push(value());
      whitespace();
      if (text[cursor] === "]") {
        cursor += 1;
        return result;
      }
      if (text[cursor++] !== ",") fail("Expected ',' or ']'");
    }
  };
  const object = () => {
    cursor += 1;
    const result = Object.create(null);
    const names = new Set();
    whitespace();
    if (text[cursor] === "}") {
      cursor += 1;
      return result;
    }
    while (true) {
      whitespace();
      if (text[cursor] !== '"') fail("Expected an object property");
      const name = string();
      if (names.has(name)) fail(`Duplicate JSON property ${JSON.stringify(name)}`);
      names.add(name);
      whitespace();
      if (text[cursor++] !== ":") fail("Expected ':'");
      result[name] = value();
      whitespace();
      if (text[cursor] === "}") {
        cursor += 1;
        return result;
      }
      if (text[cursor++] !== ",") fail("Expected ',' or '}'");
    }
  };

  const result = value();
  whitespace();
  if (cursor !== text.length) fail("Unexpected trailing JSON content");
  return result;
}
