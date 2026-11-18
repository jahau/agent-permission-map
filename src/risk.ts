import type { Finding, McpServer, Scope, Severity } from "./types.js";

export type LocalFinding = Omit<Finding, "source" | "agent">;

// ---------------------------------------------------------------------------
// Shell allow rules
// ---------------------------------------------------------------------------

/** Programs that run arbitrary code given arguments. Allowing them with a wildcard allows anything. */
const CODE_RUNNERS = new Set([
  "sh", "bash", "zsh", "fish", "dash", "ksh", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh",
  "python", "python3", "py", "node", "deno", "bun", "ruby", "perl", "php", "lua", "osascript",
  "npx", "bunx", "pnpx", "uvx", "pipx", "dlx", "uv", "eval", "exec", "env", "sudo", "su", "doas",
  "xargs", "docker", "podman", "kubectl", "ssh", "nix", "wsl", "wsl.exe", "start-process", "invoke-expression", "iex",
]);

/** Programs that run project-defined scripts. Safe only as far as the repository is trusted. */
const SCRIPT_RUNNERS = new Set(["npm", "pnpm", "yarn", "make", "just", "task", "gradle", "gradlew", "./gradlew", "mvn", "cargo", "go", "dotnet", "rake", "composer", "poetry", "pip", "pip3"]);

/** Programs that move data over the network. */
const NETWORK_TOOLS = new Set(["curl", "wget", "nc", "ncat", "netcat", "scp", "rsync", "ftp", "sftp", "telnet", "invoke-webrequest", "iwr", "invoke-restmethod", "irm"]);

const DESTRUCTIVE = new Set(["rm", "del", "rmdir", "rd", "remove-item", "shred", "dd", "mkfs", "format", "chmod", "chown", "git"]);

export interface ShellRuleAnalysis {
  /** The whole shell tool is covered. */
  unrestricted: boolean;
  program: string | null;
  /**
   * The wildcard leaves the dangerous part open: it follows the program directly
   * (`python *`) or a subcommand that takes arbitrary input (`npm run *`, `docker run *`).
   * `git diff *` or `npm run test *` are not open-ended in this sense.
   */
  openEnded: boolean;
  category: "code-runner" | "script-runner" | "network" | "destructive" | "other" | "all";
}

/** Subcommands after which a wildcard is as broad as a wildcard on the program itself. */
const OPEN_SUBCOMMANDS: Record<string, Set<string>> = {
  "code-runner": new Set(["run", "exec", "-c", "-e", "--eval", "x", "dlx", "eval", "-m", "/c", "-command", "compose", "tool"]),
  "script-runner": new Set(["run", "run-script", "exec", "x", "dlx", "install", "i", "add", "start"]),
  destructive: new Set(["push", "reset", "clean", "rebase", "checkout", "restore", "branch", "-rf", "-fr", "-r", "-f", "/s", "-recurse"]),
  network: new Set([]),
  other: new Set([]),
};

/**
 * Analyze the inside of a shell rule such as `npm run *`, `git:*`, `curl`, `*`.
 * Accepts Claude Code (`Bash(cmd *)`, legacy `cmd:*`) and Cursor (`Shell(cmd:*)`) spec styles.
 */
export function analyzeShellSpec(spec: string | null): ShellRuleAnalysis {
  const all: ShellRuleAnalysis = { unrestricted: true, program: null, openEnded: true, category: "all" };
  if (spec === null) return all;
  const s = spec.trim();
  if (s === "" || /^\*+$/.test(s) || s === ":*") return all;
  const anyArgs = /(\s\*|:\*|\*)\s*$/.test(s);
  const prefix = s.replace(/(\s\*|:\*|\*)\s*$/, "").trim();
  const tokens = prefix.split(/\s+/).filter(Boolean);
  const program = (tokens[0] ?? "").replace(/^["']|["']$/g, "").replace(/^.*[\\/]/, "").toLowerCase();
  if (program === "*" || program === "") return all;
  let category: ShellRuleAnalysis["category"] = "other";
  if (CODE_RUNNERS.has(program)) category = "code-runner";
  else if (NETWORK_TOOLS.has(program)) category = "network";
  else if (SCRIPT_RUNNERS.has(program)) category = "script-runner";
  else if (DESTRUCTIVE.has(program)) category = "destructive";
  const second = tokens[1]?.toLowerCase();
  const openEnded =
    anyArgs && (tokens.length === 1 || (tokens.length === 2 && second !== undefined && (OPEN_SUBCOMMANDS[category]?.has(second) ?? false)));
  return { unrestricted: false, program, openEnded, category };
}

/** Findings for an allow rule over the shell. Returns null when the rule is narrow enough not to flag. */
export function shellAllowFinding(ruleText: string, spec: string | null, scope: Scope, agentLabel: string): LocalFinding | null {
  const a = analyzeShellSpec(spec);
  const shared = scope === "project" ? " Because this file is shared through the repository, anyone who can commit to it can widen what the agent runs on your machine once you trust the folder." : "";
  if (a.unrestricted) {
    return {
      ruleId: "shell.allow-all",
      severity: "high",
      subject: ruleText,
      title: "Every shell command runs without asking",
      explanation: `${agentLabel} will run any shell command the model chooses without a confirmation prompt. A prompt injection in a file, web page or tool result can then run arbitrary code with your user's permissions.${shared}`,
      recommendation: "Replace the blanket rule with specific commands (for example `npm test`), and add deny rules for network and destructive commands.",
    };
  }
  if (!a.openEnded) return null;
  if (a.category === "code-runner") {
    return {
      ruleId: "shell.allow-code-runner",
      severity: "high",
      subject: ruleText,
      title: `\`${a.program}\` may run with any arguments`,
      explanation: `\`${a.program}\` executes whatever code or command it is given, so allowing it with a wildcard is equivalent to allowing every shell command.${shared}`,
      recommendation: `Allow the exact invocations you need instead of \`${a.program}\` with a wildcard.`,
    };
  }
  if (a.category === "network") {
    return {
      ruleId: "shell.allow-network-tool",
      severity: "medium",
      subject: ruleText,
      title: `\`${a.program}\` may reach any host`,
      explanation: `A wildcard rule for \`${a.program}\` lets the agent download code or upload local files to any address without asking, which is the usual exfiltration path after a prompt injection.${shared}`,
      recommendation: "Remove the rule and use the agent's own fetch tool with a domain allowlist, or allow only specific URLs.",
    };
  }
  if (a.category === "script-runner") {
    return {
      ruleId: "shell.allow-script-runner",
      severity: "medium",
      subject: ruleText,
      title: `\`${a.program}\` may run any project script`,
      explanation: `\`${a.program}\` with a wildcard runs whatever the project's build files define, and some subcommands install or execute packages. The agent can edit those files and then run them.${shared}`,
      recommendation: `Allow the specific subcommands you need (for example \`${a.program} test\`).`,
    };
  }
  if (a.category === "destructive") {
    return {
      ruleId: "shell.allow-destructive",
      severity: "medium",
      subject: ruleText,
      title: `\`${a.program}\` may run with any arguments`,
      explanation: `\`${a.program}\` can delete or rewrite files and history. With a wildcard there is no prompt before, for example, a recursive delete or a force push.${shared}`,
      recommendation: `Allow the specific, non-destructive forms you need, and add deny or ask rules for the destructive ones.`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

const PACKAGE_RUNNERS: Record<string, string[]> = {
  npx: [], bunx: [], pnpx: [], uvx: [], pipx: ["run"], pnpm: ["dlx"], yarn: ["dlx"], bun: ["x"], uv: ["tool", "run"],
};

/** Flags of package runners that take a value. */
const FLAGS_WITH_VALUE = new Set(["-p", "--package", "--from", "--with", "--python", "--registry", "--cache", "--index-url", "-c", "--call"]);

function baseProgram(cmd: string): string {
  return cmd.trim().replace(/^["']|["']$/g, "").replace(/^.*[\\/]/, "").replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
}

/** Locate the package a runner like `npx -y pkg@1` will download, or null if this is not a package runner. */
export function packageSpecFor(command: string, args: readonly string[]): { runner: string; pkg: string } | null {
  const runner = baseProgram(command);
  const sub = PACKAGE_RUNNERS[runner];
  if (!sub) return null;
  for (let k = 0; k < sub.length; k++) {
    if (args[k] !== sub[k]) return null;
  }
  for (let i = sub.length; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--") continue;
    if (a.startsWith("-")) {
      if (FLAGS_WITH_VALUE.has(a)) {
        // `--from pkg` / `-p pkg` names the package explicitly
        if ((a === "--from" || a === "-p" || a === "--package") && args[i + 1]) return { runner, pkg: args[i + 1]! };
        i++;
      }
      continue;
    }
    return { runner, pkg: a };
  }
  return null;
}

/** True when the package spec names an exact version. */
export function isPinned(pkg: string, runner: string): boolean {
  if (/^(\.{0,2}[\\/]|[A-Za-z]:[\\/]|file:|git\+|https?:)/.test(pkg)) return true; // local path or explicit URL
  if (runner === "uvx" || runner === "pipx" || runner === "uv") {
    if (/==\s*\d/.test(pkg)) return true;
    const m = /@(.+)$/.exec(pkg);
    return !!m && /^\d/.test(m[1]!);
  }
  const at = pkg.startsWith("@") ? pkg.indexOf("@", 1) : pkg.indexOf("@");
  if (at <= 0) return false;
  const version = pkg.slice(at + 1);
  return /^v?\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version);
}

/** Host-side paths of `-v`, `--volume` and `--mount` options. */
export function containerMountSources(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    let value: string | undefined;
    let isMount = false;
    if (a === "-v" || a === "--volume") value = args[++i];
    else if (a === "--mount") { value = args[++i]; isMount = true; }
    else if (/^(-v|--volume)=/.test(a)) value = a.slice(a.indexOf("=") + 1);
    else if (a.startsWith("--mount=")) { value = a.slice(8); isMount = true; }
    else if (/^-v\S/.test(a)) value = a.slice(2);
    if (value === undefined) continue;
    if (isMount) {
      const m = /(?:^|,)(?:source|src)=([^,]+)/.exec(value);
      if (m?.[1]) out.push(m[1]);
      continue;
    }
    // Windows drive paths contain a colon: C:\Users:/data
    const drive = /^([A-Za-z]:[\\/][^:]*)(:|$)/.exec(value);
    out.push(drive ? drive[1]! : value.split(":")[0]!);
  }
  return out;
}

function isSensitiveHostPath(p: string): boolean {
  const v = p.replace(/^["']|["']$/g, "").replace(/[\\/]+$/, "");
  return (
    v === "" || // "/" after trimming
    /^[A-Za-z]:$/.test(v) ||
    v === "~" ||
    /^(\$HOME|\$\{HOME\}|%USERPROFILE%|\$env:USERPROFILE)$/i.test(v) ||
    /^\/(home|Users)(\/[^/]+)?$/.test(v) ||
    /^[A-Za-z]:[\\/]Users([\\/][^\\/]+)?$/i.test(v) ||
    /docker\.sock$/.test(v) ||
    v === "/etc" || v === "/root"
  );
}

function isLoopback(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || h.startsWith("127.") || h.endsWith(".localhost");
}

export type ServerFacts = Omit<McpServer, "source" | "agent">;

export interface ServerSecrets {
  /** Env or header names whose values look like inline credentials. */
  inlineSecretKeys: string[];
  argsRedacted: number;
  urlHadCredentials: boolean;
}

/** Findings shared by every client's MCP server format. */
export function mcpServerFindings(s: ServerFacts, secrets: ServerSecrets, scope: Scope): LocalFinding[] {
  const out: LocalFinding[] = [];
  const subject = s.context ? `${s.name} (${s.context})` : s.name;
  const disabledNote = s.enabled ? "" : " The server is currently disabled, but the configuration is still on disk.";

  if (secrets.inlineSecretKeys.length > 0 || secrets.argsRedacted > 0 || secrets.urlHadCredentials) {
    const where: string[] = [];
    if (secrets.inlineSecretKeys.length > 0) where.push(`\`${secrets.inlineSecretKeys.join("`, `")}\``);
    if (secrets.argsRedacted > 0) where.push("command arguments");
    if (secrets.urlHadCredentials) where.push("the URL");
    out.push({
      ruleId: "mcp.inline-secret",
      severity: scope === "project" ? "critical" : "high",
      subject,
      title: "Credential written directly in the config file",
      explanation: `A value in ${where.join(", ")} looks like a literal credential. It is stored in plain text${scope === "project" ? " in a file meant to be committed to the repository" : ""}, ends up in backups and screen shares, and is readable by any process running as you. The value is not shown in this report.${disabledNote}`,
      recommendation: "Move the value to an environment variable or the client's secret input (for example `${env:NAME}` or `${input:id}`), then rotate the credential.",
    });
  }

  if (s.transport === "stdio" && s.command) {
    const pkg = packageSpecFor(s.command, s.args);
    if (pkg && !isPinned(pkg.pkg, pkg.runner)) {
      out.push({
        ruleId: "mcp.unpinned-package",
        severity: "medium",
        subject,
        title: `\`${pkg.runner}\` downloads \`${pkg.pkg}\` without a fixed version`,
        explanation: `Each start resolves the newest published version of \`${pkg.pkg}\` and runs it with your user's permissions. A compromised or hijacked release reaches you automatically, before you review it.${disabledNote}`,
        recommendation: `Pin an exact version (for example \`${pkg.pkg.replace(/@latest$/, "")}@1.2.3\`) and update it deliberately.`,
      });
    }
    const prog = baseProgram(s.command);
    const flagIndex = s.args.findIndex((a) => /^(-c|\/c|\/k|-command|-encodedcommand|-e|--eval)$/i.test(a));
    if (["sh", "bash", "zsh", "dash", "cmd", "powershell", "pwsh", "node", "python", "python3"].includes(prog) && flagIndex !== -1) {
      out.push({
        ruleId: "mcp.shell-wrapper",
        severity: "medium",
        subject,
        title: "Server is started through an inline script",
        explanation: `The server is launched as \`${prog} ${s.args[flagIndex]} …\`, so the real command is a script string. Inline scripts are hard to review and can chain extra commands, downloads or environment changes before the server starts.${disabledNote}`,
        recommendation: "Point `command` at the server executable directly, or move the script into a reviewed file in the repository.",
      });
    }
    if (prog === "docker" || prog === "podman") {
      const joined = s.args.join(" ");
      const reasons: string[] = [];
      if (/--privileged\b/.test(joined)) reasons.push("`--privileged`");
      if (containerMountSources(s.args).some(isSensitiveHostPath)) reasons.push("a host root, home or Docker socket mount");
      if (/--(network|net)[ =]host\b/.test(joined)) reasons.push("`--network host`");
      if (/--pid[ =]host\b/.test(joined)) reasons.push("`--pid host`");
      if (reasons.length > 0) {
        out.push({
          ruleId: "mcp.container-escape",
          severity: "high",
          subject,
          title: "Container runs with host-level access",
          explanation: `The container is started with ${reasons.join(", ")}, which removes most of the isolation a container would otherwise provide.${disabledNote}`,
          recommendation: "Drop the privileged options and mount only the directories the server needs, read-only where possible.",
        });
      }
    }
  }

  if (s.url && (s.transport === "http" || s.transport === "sse" || s.transport === "ws" || s.transport === "unknown")) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(s.url.replace(/\[REDACTED\]/g, "x"));
    } catch {
      parsed = null;
    }
    if (parsed && (parsed.protocol === "http:" || parsed.protocol === "ws:") && !isLoopback(parsed.hostname)) {
      out.push({
        ruleId: "mcp.plaintext-remote",
        severity: "high",
        subject,
        title: "Remote server is reached without TLS",
        explanation: `\`${parsed.host}\` is contacted over \`${parsed.protocol.replace(":", "")}\`. Anyone on the network path can read tool calls and results, and can inject tool descriptions or responses.${disabledNote}`,
        recommendation: "Use an `https://` (or `wss://`) URL.",
      });
    } else if (parsed && !isLoopback(parsed.hostname)) {
      out.push({
        ruleId: "mcp.remote-server",
        severity: "info",
        subject,
        title: `Tool calls are sent to \`${parsed.host}\``,
        explanation: `Arguments the agent passes to this server's tools, which can include file contents, leave your machine for \`${parsed.host}\`.${disabledNote}`,
        recommendation: "Confirm you trust the operator of this host with the data your agent handles.",
      });
    }
  }

  if (s.autoApprove === "all") {
    out.push({
      ruleId: "mcp.auto-approved",
      severity: "high",
      subject,
      title: "All of this server's tools run without confirmation",
      explanation: `The client is configured to trust this server, so every tool it exposes runs without a prompt. Tool descriptions and results are model input, so a malicious or compromised server can steer the agent and act immediately.${disabledNote}`,
      recommendation: "Remove the blanket trust and approve individual read-only tools instead.",
    });
  }

  if (s.envFile) {
    out.push({
      ruleId: "mcp.env-file",
      severity: "info",
      subject,
      title: "Server loads variables from an env file",
      explanation: `The client passes the contents of \`${s.envFile}\` to the server. This tool does not open that file, so whatever it contains is not reflected in this report.`,
      recommendation: "Make sure the env file is not committed, and that it holds only what this server needs.",
    });
  }

  if (scope === "project" && s.transport === "stdio" && s.enabled) {
    out.push({
      ruleId: "mcp.project-command",
      severity: "info",
      subject,
      title: "Repository config can start a local process",
      explanation: "This server is defined in a file inside the project. After you approve it, the client starts the command with your user's permissions every session, and later commits can change the command.",
      recommendation: "Review changes to this file in code review as you would changes to a build script.",
    });
  }

  return out;
}

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
