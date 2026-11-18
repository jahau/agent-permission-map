/** Agents (clients) whose configuration this tool understands. */
export type Agent =
  | "claude-code"
  | "claude-desktop"
  | "codex"
  | "copilot"
  | "cursor"
  | "gemini-cli"
  | "vscode"
  | "windsurf";

/** Who a configuration file applies to. */
export type Scope = "managed" | "system" | "user" | "project" | "local";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low", "info"];

export type Effect = "allow" | "ask" | "deny";

/** Normalized capability a permission rule governs. */
export type Capability =
  | "all"
  | "shell"
  | "file-read"
  | "file-write"
  | "network"
  | "mcp"
  | "directory"
  | "tool"
  | "other";

export type Transport = "stdio" | "http" | "sse" | "ws" | "unknown";

/** The on-disk format a parser expects. */
export type FileFormat =
  | "claude-settings"
  | "claude-global"
  | "mcp-servers-json"
  | "vscode-mcp"
  | "cursor-cli"
  | "gemini-settings"
  | "codex-toml";

export interface SourceFile {
  /** Stable identifier, e.g. "S03". Assigned after sorting. */
  id: string;
  agent: Agent;
  scope: Scope;
  format: FileFormat;
  /** Display path: "~/..." for home, "./..." for the project, absolute otherwise. Always "/" separated. */
  path: string;
  status: "parsed" | "error";
  error?: string;
  warnings: string[];
}

export interface PermissionRule {
  agent: Agent;
  source: string;
  effect: Effect;
  capability: Capability;
  /** The rule exactly as written in the file (secrets redacted). */
  rule: string;
  /** True when the rule covers a whole capability rather than a narrow target. */
  broad: boolean;
  /** Extra context, e.g. "profile: ci". */
  context?: string;
}

/** A non-rule setting that changes the permission posture (modes, sandbox, trust). */
export interface PostureSetting {
  agent: Agent;
  source: string;
  key: string;
  value: string | number | boolean | null;
  context?: string;
}

export interface McpServer {
  agent: Agent;
  source: string;
  name: string;
  transport: Transport;
  command?: string;
  /** Arguments with secret-looking values replaced by "[REDACTED]". */
  args: string[];
  /** URL with credentials and query values redacted. */
  url?: string;
  cwd?: string;
  /** Names of environment variables passed to the server. Values are never reported. */
  envKeys: string[];
  /** Names of HTTP headers sent to the server. Values are never reported. */
  headerKeys: string[];
  /** Path to an env file the client loads. The file itself is never read. */
  envFile?: string;
  enabled: boolean;
  /** Whether the client skips confirmation for this server's tools, when the format can say so. */
  autoApprove: "all" | "some" | "none" | "unspecified";
  toolsAllowed?: string[];
  toolsDenied?: string[];
  context?: string;
}

export interface Hook {
  agent: Agent;
  source: string;
  event: string;
  matcher?: string;
  type: string;
  /** Hook command, secret-looking tokens redacted. */
  command: string;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  agent: Agent;
  source: string;
  /** What the finding is about, e.g. a rule string or a server name. */
  subject: string;
  title: string;
  explanation: string;
  recommendation: string;
}

export interface Report {
  schemaVersion: 1;
  generator: { name: string; version: string };
  scan: {
    projectName: string | null;
    includeUser: boolean;
    includeSystem: boolean;
    locationsChecked: number;
  };
  summary: {
    sources: number;
    sourcesWithErrors: number;
    permissionRules: number;
    mcpServers: number;
    hooks: number;
    findings: Record<Severity, number>;
    highestSeverity: Severity | null;
    agents: Agent[];
  };
  sources: SourceFile[];
  permissions: PermissionRule[];
  posture: PostureSetting[];
  mcpServers: McpServer[];
  hooks: Hook[];
  findings: Finding[];
}

/** What a parser returns for one file, before ids are assigned. */
export interface ParseResult {
  warnings: string[];
  permissions: Omit<PermissionRule, "source" | "agent">[];
  posture: Omit<PostureSetting, "source" | "agent">[];
  mcpServers: Omit<McpServer, "source" | "agent">[];
  hooks: Omit<Hook, "source" | "agent">[];
  findings: Omit<Finding, "source" | "agent">[];
}

export interface ParseContext {
  agent: Agent;
  scope: Scope;
  displayPath: string;
  /** Absolute, normalized project root when scanning a project (used to pick ~/.claude.json entries). */
  projectRoot: string | null;
}

export function emptyResult(): ParseResult {
  return { warnings: [], permissions: [], posture: [], mcpServers: [], hooks: [], findings: [] };
}
