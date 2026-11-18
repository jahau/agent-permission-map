import { promises as fs } from "node:fs";
import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";

/** Files larger than this are skipped. ~/.claude.json can grow large, so the cap is generous. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type ReadOutcome =
  | { kind: "missing" }
  | { kind: "error"; error: string }
  | { kind: "ok"; text: string };

/**
 * Read a config file as UTF-8 text without modifying anything.
 * Opens read-only, refuses non-regular files and oversize files, strips a BOM,
 * and rejects bytes that are not valid UTF-8.
 */
export async function readConfigFile(absPath: string): Promise<ReadOutcome> {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { kind: "missing" };
    return { kind: "error", error: `cannot stat file (${code ?? "unknown error"})` };
  }
  if (!stat.isFile()) return { kind: "error", error: "not a regular file" };
  if (stat.size > MAX_FILE_BYTES) {
    return { kind: "error", error: `file is larger than ${MAX_FILE_BYTES} bytes; skipped` };
  }
  let buf: Buffer;
  try {
    buf = await fs.readFile(absPath, { flag: "r" });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { kind: "error", error: `cannot read file (${code ?? "unknown error"})` };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return { kind: "error", error: "file is not valid UTF-8" };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { kind: "ok", text };
}

export type ParsedData = { ok: true; value: unknown; warnings: string[] } | { ok: false; error: string };

/**
 * Parse JSON. Strict JSON is tried first. If that fails, a lenient JSONC parse
 * (comments, trailing commas) is attempted; for formats that require strict JSON
 * a warning is attached, because the agent itself may reject the file.
 */
export function parseJsonText(text: string, opts: { strict: boolean }): ParsedData {
  if (text.trim() === "") return { ok: false, error: "file is empty" };
  try {
    return { ok: true, value: JSON.parse(text), warnings: [] };
  } catch {
    // fall through to lenient parse
  }
  const errors: ParseError[] = [];
  const value = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    const first = errors[0]!;
    const { line, column } = offsetToLineCol(text, first.offset);
    return { ok: false, error: `invalid JSON: ${printParseErrorCode(first.error)} at line ${line}, column ${column}` };
  }
  const warnings = opts.strict
    ? ["file contains comments or trailing commas; the agent expects strict JSON and may reject this file"]
    : [];
  return { ok: true, value, warnings };
}

export function parseTomlText(text: string): ParsedData {
  if (text.trim() === "") return { ok: true, value: {}, warnings: ["file is empty"] };
  try {
    return { ok: true, value: parseToml(text), warnings: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] ?? "parse error" : "parse error";
    return { ok: false, error: `invalid TOML: ${msg}` };
  }
}

function offsetToLineCol(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, column: offset - last };
}

// ---- Type guards used by every parser. Config files are untrusted input. ----

export type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** Return the string members of an array, recording a warning for anything else. */
export function strArray(v: unknown, field: string, warnings: string[]): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    warnings.push(`${field} should be an array; ignored`);
    return [];
  }
  const out: string[] = [];
  let bad = 0;
  for (const item of v) {
    if (typeof item === "string") out.push(item);
    else bad++;
  }
  if (bad > 0) warnings.push(`${field} has ${bad} non-string entr${bad === 1 ? "y" : "ies"}; ignored`);
  return out;
}

/** Keys of an object, sorted, recording a warning if the value is not an object. */
export function objKeys(v: unknown, field: string, warnings: string[]): string[] {
  if (v === undefined) return [];
  if (!isObj(v)) {
    warnings.push(`${field} should be an object; ignored`);
    return [];
  }
  return Object.keys(v).sort();
}

/** Render a scalar for a posture entry. */
export function scalar(v: unknown): string | number | boolean | null {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return `[${v.length} item${v.length === 1 ? "" : "s"}]`;
  if (isObj(v)) return "{object}";
  return String(v);
}
