import { existsSync, promises as fs, constants as fsConstants } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { renderHtml } from "./render/html.js";
import { renderJson } from "./render/json.js";
import { renderText } from "./render/text.js";
import { scan, severityAtLeast } from "./scan.js";
import { SEVERITIES, type Report, type Severity } from "./types.js";
import { VERSION } from "./version.js";

const HELP = `agent-permission-map ${VERSION}
Inventory what your AI coding agents may do without asking. Read-only and offline.

Usage
  agent-permission-map [scan] [options]
  agent-permission-map demo [options]      Scan the bundled example fixtures

Options
  --project <dir>     Project to scan (default: current directory)
  --no-project        Skip project-level files
  --home <dir>        Home directory to scan (default: your home directory).
                      Setting it also ignores CLAUDE_CONFIG_DIR, CODEX_HOME,
                      APPDATA and similar variables, for reproducible output.
  --no-user           Skip user-level files
  --system            Also read managed/system policy files for this OS
  --format <fmt>      text (default), json or html
  --out <file>        Write the report to a new file instead of stdout
  --force             Allow --out to replace an existing file
  --fail-on <sev>     Exit 1 if any finding is at or above: critical, high,
                      medium, low, info (default: never)
  --max-findings <n>  Findings shown in text output (default 50)
  -h, --help          Show this help
  -v, --version       Show the version

Exit codes: 0 ok, 1 findings at or above --fail-on, 2 usage or I/O error.
Nothing is executed, no network connection is made, and only --out is written.
`;

class UsageError extends Error {}

/** Bundled fixtures: <pkg>/fixtures/demo, found from dist/ or build-test/src/. */
function demoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, "fixtures", "demo");
    if (existsSync(path.join(candidate, "acme-api"))) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error("bundled demo fixtures not found");
}

/** Env vars that relocate config directories. Only read when --home is not given. */
function relocationEnv(): Record<string, string | undefined> {
  const keep = ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "COPILOT_HOME", "APPDATA", "XDG_CONFIG_HOME", "ProgramData", "PROGRAMDATA", "ProgramFiles", "PROGRAMFILES"];
  const out: Record<string, string | undefined> = {};
  for (const k of keep) if (process.env[k]) out[k] = process.env[k];
  return out;
}

export interface CliIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  cwd: string;
}

export async function main(argv: string[], io: CliIO): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        project: { type: "string" },
        "no-project": { type: "boolean" },
        home: { type: "string" },
        "no-user": { type: "boolean" },
        system: { type: "boolean" },
        format: { type: "string" },
        out: { type: "string" },
        force: { type: "boolean" },
        "fail-on": { type: "string" },
        "max-findings": { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (err) {
    io.stderr(`error: ${err instanceof Error ? err.message : String(err)}\nRun with --help for usage.\n`);
    return 2;
  }
  const v = parsed.values;
  if (v.help) {
    io.stdout(HELP);
    return 0;
  }
  if (v.version) {
    io.stdout(VERSION + "\n");
    return 0;
  }

  try {
    const [command = "scan", ...rest] = parsed.positionals;
    if (rest.length > 0) throw new UsageError(`unexpected argument "${rest[0]}"`);
    if (command !== "scan" && command !== "demo") throw new UsageError(`unknown command "${command}"`);

    const format = v.format ?? "text";
    if (!["text", "json", "html"].includes(format)) throw new UsageError(`--format must be text, json or html`);
    const failOn = v["fail-on"];
    if (failOn !== undefined && !SEVERITIES.includes(failOn as Severity)) throw new UsageError(`--fail-on must be one of ${SEVERITIES.join(", ")}`);
    let maxFindings = 50;
    if (v["max-findings"] !== undefined) {
      maxFindings = Number.parseInt(v["max-findings"], 10);
      if (!Number.isFinite(maxFindings) || maxFindings < 0) throw new UsageError("--max-findings must be a non-negative integer");
    }
    if (v.project && v["no-project"]) throw new UsageError("--project and --no-project cannot be combined");
    if (v.home && v["no-user"]) throw new UsageError("--home and --no-user cannot be combined");

    let report: Report;
    if (command === "demo") {
      if (v.project || v.home || v.system || v["no-project"] || v["no-user"]) throw new UsageError("demo scans the bundled fixtures; --project, --home, --system, --no-project and --no-user do not apply");
      const root = demoRoot();
      report = await scan({ project: path.join(root, "acme-api"), home: path.join(root, "home"), env: {} });
    } else {
      const project = v["no-project"] ? null : path.resolve(io.cwd, v.project ?? ".");
      if (project) await assertDir(project, "--project");
      let home: string | null = null;
      let env: Record<string, string | undefined> = {};
      if (!v["no-user"]) {
        if (v.home) {
          home = path.resolve(io.cwd, v.home);
          await assertDir(home, "--home");
        } else {
          home = os.homedir();
          env = relocationEnv();
        }
      }
      report = await scan({ project, home, includeSystem: v.system ?? false, env });
    }

    const output = format === "json" ? renderJson(report) : format === "html" ? renderHtml(report) : renderText(report, { maxFindings });
    if (v.out) {
      const outPath = path.resolve(io.cwd, v.out);
      await writeNew(outPath, output, v.force ?? false);
      io.stderr(`Wrote ${format} report to ${outPath}\n`);
      if (format !== "text") io.stdout(renderText(report, { maxFindings: 0 }));
    } else {
      io.stdout(output);
    }

    if (failOn && report.findings.some((f) => severityAtLeast(f.severity, failOn as Severity))) return 1;
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr(`error: ${err.message}\nRun with --help for usage.\n`);
      return 2;
    }
    io.stderr(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
}

async function assertDir(p: string, label: string): Promise<void> {
  let st;
  try {
    st = await fs.stat(p);
  } catch {
    throw new UsageError(`${label}: directory not found: ${p}`);
  }
  if (!st.isDirectory()) throw new UsageError(`${label}: not a directory: ${p}`);
}

/** Write a new file. Refuses to replace an existing one unless forced. */
async function writeNew(p: string, data: string, force: boolean): Promise<void> {
  const flag = force ? fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC : fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL;
  let fh;
  try {
    fh = await fs.open(p, flag, 0o644);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new UsageError(`--out: ${p} already exists (use --force to replace it)`);
    throw err;
  }
  try {
    await fh.writeFile(data, "utf8");
  } finally {
    await fh.close();
  }
}
