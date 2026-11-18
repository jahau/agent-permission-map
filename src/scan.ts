import * as path from "node:path";
import { candidates, type Candidate } from "./discover.js";
import { parseClaudeGlobal, parseClaudeSettings } from "./parsers/claude.js";
import { parseCodexConfig } from "./parsers/codex.js";
import { parseGeminiSettings } from "./parsers/gemini.js";
import { parseCursorCli, parseMcpServersJson, parseVscodeMcp } from "./parsers/mcp-files.js";
import { displayPath, normalizeFsPath } from "./paths.js";
import { parseJsonText, parseTomlText, readConfigFile } from "./read.js";
import { SEVERITY_RANK } from "./risk.js";
import {
  SEVERITIES,
  type Agent,
  type FileFormat,
  type Finding,
  type ParseContext,
  type ParseResult,
  type Report,
  type Severity,
  type SourceFile,
} from "./types.js";
import { VERSION } from "./version.js";

export interface ScanOptions {
  /** Project directory to scan. Null skips project files. */
  project: string | null;
  /** Home directory. Null skips user files. */
  home: string | null;
  includeSystem?: boolean;
  /** Environment overrides; see DiscoverOptions.env. */
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
}

/** Formats that the agent itself parses as strict JSON. */
const STRICT_JSON: ReadonlySet<FileFormat> = new Set(["claude-settings", "claude-global", "cursor-cli"]);

function parseFor(format: FileFormat, data: unknown, ctx: ParseContext): ParseResult {
  switch (format) {
    case "claude-settings":
      return parseClaudeSettings(data, ctx);
    case "claude-global":
      return parseClaudeGlobal(data, ctx);
    case "mcp-servers-json":
      return parseMcpServersJson(data, ctx);
    case "vscode-mcp":
      return parseVscodeMcp(data, ctx);
    case "cursor-cli":
      return parseCursorCli(data, ctx);
    case "gemini-settings":
      return parseGeminiSettings(data, ctx);
    case "codex-toml":
      return parseCodexConfig(data, ctx);
  }
}

interface Collected {
  candidate: Candidate;
  display: string;
  status: "parsed" | "error";
  error?: string;
  result: ParseResult;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface AnalyzedText {
  status: "parsed" | "error";
  error?: string;
  result: ParseResult;
}

/** Parse and analyze the text of one config file. Never throws. */
export function analyzeText(format: FileFormat, text: string, ctx: ParseContext): AnalyzedText {
  const parsed = format === "codex-toml" ? parseTomlText(text) : parseJsonText(text, { strict: STRICT_JSON.has(format) });
  if (!parsed.ok) return { status: "error", error: parsed.error, result: emptyParse() };
  let result: ParseResult;
  try {
    result = parseFor(format, parsed.value, ctx);
  } catch (err) {
    // A parser bug must not abort the whole scan or leak file contents.
    return { status: "error", error: `internal error while analyzing (${err instanceof Error ? err.name : "unknown"})`, result: emptyParse() };
  }
  result.warnings.unshift(...parsed.warnings);
  return { status: "parsed", result };
}

/**
 * Scan configuration files and build a report.
 * Read-only: files are opened for reading only, nothing is executed, and no
 * network module is loaded. Output depends only on file contents and the
 * options, so the same inputs give byte-identical reports.
 */
export async function scan(opts: ScanOptions): Promise<Report> {
  const project = opts.project ? path.resolve(opts.project) : null;
  const home = opts.home ? path.resolve(opts.home) : null;
  const roots = { home, project };
  const list = candidates({ home, project, includeSystem: opts.includeSystem ?? false, env: opts.env ?? {}, platform: opts.platform });

  const collected: Collected[] = [];
  // Sequential on purpose: keeps file access order and error output deterministic.
  for (const c of list) {
    const read = await readConfigFile(c.path);
    if (read.kind === "missing") continue;
    const display = displayPath(c.path, roots);
    const ctx: ParseContext = { agent: c.agent, scope: c.scope, displayPath: display, projectRoot: project ? normalizeFsPath(project) : null };
    if (read.kind === "error") {
      collected.push({ candidate: c, display, status: "error", error: read.error, result: emptyParse() });
      continue;
    }
    collected.push({ candidate: c, display, ...analyzeText(c.format, read.text, ctx) });
  }

  collected.sort((a, b) => cmp(a.candidate.agent, b.candidate.agent) || cmp(scopeOrder(a.candidate.scope), scopeOrder(b.candidate.scope)) || cmp(a.display, b.display));

  const report: Report = {
    schemaVersion: 1,
    generator: { name: "agent-permission-map", version: VERSION },
    scan: {
      projectName: project ? path.basename(project) : null,
      includeUser: home !== null,
      includeSystem: opts.includeSystem ?? false,
      locationsChecked: list.length,
    },
    summary: {
      sources: 0,
      sourcesWithErrors: 0,
      permissionRules: 0,
      mcpServers: 0,
      hooks: 0,
      findings: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      highestSeverity: null,
      agents: [],
    },
    sources: [],
    permissions: [],
    posture: [],
    mcpServers: [],
    hooks: [],
    findings: [],
  };

  collected.forEach((c, i) => {
    const id = `S${String(i + 1).padStart(2, "0")}`;
    const agent = c.candidate.agent;
    const src: SourceFile = {
      id,
      agent,
      scope: c.candidate.scope,
      format: c.candidate.format,
      path: c.display,
      status: c.status,
      warnings: [...new Set(c.result.warnings)],
    };
    if (c.error) src.error = c.error;
    report.sources.push(src);
    const tag = <T extends object>(x: T): T & { agent: Agent; source: string } => ({ agent, source: id, ...x });
    report.permissions.push(...c.result.permissions.map(tag));
    report.posture.push(...c.result.posture.map(tag));
    report.mcpServers.push(...c.result.mcpServers.map(tag));
    report.hooks.push(...c.result.hooks.map(tag));
    report.findings.push(...c.result.findings.map(tag));
    if (c.status === "error") {
      report.findings.push({
        ruleId: "source.unreadable",
        severity: "info",
        agent,
        source: id,
        subject: c.display,
        title: "File could not be analyzed",
        explanation: `${c.error ?? "Unknown error"}. The agent may also fail to load this file, or load it differently; its permissions are not part of this report.`,
        recommendation: "Fix the file, then scan again.",
      });
    }
  });

  const effectOrder = { deny: 0, ask: 1, allow: 2 } as const;
  report.permissions.sort((a, b) => cmp(a.source, b.source) || effectOrder[a.effect] - effectOrder[b.effect] || cmp(a.context ?? "", b.context ?? "") || cmp(a.rule, b.rule));
  report.posture.sort((a, b) => cmp(a.source, b.source) || cmp(a.context ?? "", b.context ?? "") || cmp(a.key, b.key) || cmp(String(a.value), String(b.value)));
  report.mcpServers.sort((a, b) => cmp(a.source, b.source) || cmp(a.context ?? "", b.context ?? "") || cmp(a.name, b.name));
  report.hooks.sort((a, b) => cmp(a.source, b.source) || cmp(a.event, b.event) || cmp(a.matcher ?? "", b.matcher ?? "") || cmp(a.command, b.command));
  report.findings = dedupeFindings(report.findings).sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || cmp(a.ruleId, b.ruleId) || cmp(a.source, b.source) || cmp(a.subject, b.subject),
  );

  const s = report.summary;
  s.sources = report.sources.length;
  s.sourcesWithErrors = report.sources.filter((x) => x.status === "error").length;
  s.permissionRules = report.permissions.length;
  s.mcpServers = report.mcpServers.length;
  s.hooks = report.hooks.length;
  for (const f of report.findings) s.findings[f.severity]++;
  s.highestSeverity = SEVERITIES.find((sev) => s.findings[sev] > 0) ?? null;
  s.agents = [...new Set(report.sources.map((x) => x.agent))].sort();
  return report;
}

function scopeOrder(scope: string): string {
  return { managed: "0", system: "1", user: "2", project: "3", local: "4" }[scope] ?? "9";
}

function emptyParse(): ParseResult {
  return { warnings: [], permissions: [], posture: [], mcpServers: [], hooks: [], findings: [] };
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.ruleId}|${f.source}|${f.subject}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function severityAtLeast(sev: Severity, threshold: Severity): boolean {
  return SEVERITY_RANK[sev] <= SEVERITY_RANK[threshold];
}
