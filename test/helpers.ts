import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../src/cli.js";
import { analyzeText } from "../src/scan.js";
import type { Agent, FileFormat, ParseContext, Scope } from "../src/types.js";

/** build-test/test/helpers.js -> repo root */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEMO = path.join(REPO, "fixtures", "demo");
export const SCHEMAS = path.join(REPO, "test", "fixtures", "schemas");

export async function analyzeFixture(file: string, format: FileFormat, agent: Agent, scope: Scope, projectRoot: string | null = null, replace?: [string, string]) {
  let text = await fs.readFile(path.join(SCHEMAS, file), "utf8");
  if (replace) text = text.split(replace[0]).join(replace[1]);
  const ctx: ParseContext = { agent, scope, displayPath: file, projectRoot };
  return analyzeText(format, text, ctx);
}

export function analyzeInline(value: unknown, format: FileFormat, agent: Agent, scope: Scope = "project") {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return analyzeText(format, text, { agent, scope, displayPath: "inline", projectRoot: null });
}

export async function tempDir(prefix = "apm-test-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function writeFiles(root: string, files: Record<string, string | Buffer>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  }
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runCli(args: string[], cwd = REPO): Promise<CliResult> {
  let stdout = "";
  let stderr = "";
  const code = await main(args, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s), cwd });
  return { code, stdout, stderr };
}

/** Hash of every file path, size, mtime and content under a directory. */
export async function treeFingerprint(root: string): Promise<string> {
  const h = createHash("sha256");
  async function walk(dir: string): Promise<void> {
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      const p = path.join(dir, e.name);
      const st = await fs.lstat(p);
      h.update(`${path.relative(root, p)}|${st.size}|${st.mtimeMs}|${st.mode}\n`);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) h.update(await fs.readFile(p));
    }
  }
  await walk(root);
  return h.digest("hex");
}
