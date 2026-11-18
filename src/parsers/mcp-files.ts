import { addServerMap, type McpDialect } from "../mcp.js";
import { isObj, str, strArray } from "../read.js";
import { redactText } from "../redact.js";
import { shellAllowFinding } from "../risk.js";
import { emptyResult, type Agent, type ParseContext, type ParseResult } from "../types.js";

const DIALECT: Record<Agent, McpDialect> = {
  "claude-code": "claude",
  "claude-desktop": "claude-desktop",
  codex: "codex",
  copilot: "copilot",
  cursor: "cursor",
  "gemini-cli": "gemini",
  vscode: "vscode",
  windsurf: "windsurf",
};

/** Files whose top level is `{ "mcpServers": { ... } }`: .mcp.json, Cursor, Claude Desktop, Windsurf, Copilot. */
export function parseMcpServersJson(data: unknown, ctx: ParseContext): ParseResult {
  const out = emptyResult();
  if (!isObj(data)) {
    out.warnings.push("top level should be a JSON object; nothing analyzed");
    return out;
  }
  if (data.mcpServers === undefined) {
    if (isObj(data.servers)) out.warnings.push('found "servers" instead of "mcpServers"; this client expects "mcpServers"');
    else out.warnings.push('no "mcpServers" object found');
    return out;
  }
  addServerMap(data.mcpServers, "mcpServers", DIALECT[ctx.agent], ctx.scope, out);
  return out;
}

/** VS Code `.vscode/mcp.json` and the user-profile `mcp.json`: `{ servers, inputs }`. */
export function parseVscodeMcp(data: unknown, ctx: ParseContext): ParseResult {
  const out = emptyResult();
  if (!isObj(data)) {
    out.warnings.push("top level should be a JSON object; nothing analyzed");
    return out;
  }
  if (data.servers === undefined && isObj(data.mcpServers)) {
    out.warnings.push('found "mcpServers"; VS Code reads "servers" in this file');
    addServerMap(data.mcpServers, "mcpServers", "vscode", ctx.scope, out);
  } else {
    addServerMap(data.servers, "servers", "vscode", ctx.scope, out);
  }
  if (data.inputs !== undefined) {
    if (!Array.isArray(data.inputs)) out.warnings.push("inputs should be an array; ignored");
    else {
      for (const input of data.inputs) {
        if (!isObj(input)) continue;
        const id = str(input.id);
        if (!id) continue;
        out.posture.push({ key: "inputs", value: `${id}${input.password === true ? " (password)" : ""}` });
      }
    }
  }
  return out;
}

/** Cursor CLI `~/.cursor/cli-config.json` and `.cursor/cli.json`: `{ permissions: { allow, deny } }`. */
export function parseCursorCli(data: unknown, ctx: ParseContext): ParseResult {
  const out = emptyResult();
  if (!isObj(data)) {
    out.warnings.push("top level should be a JSON object; nothing analyzed");
    return out;
  }
  // Only permissions are read; the rest of the file can hold account state.
  const perms = data.permissions;
  if (perms === undefined) return out;
  if (!isObj(perms)) {
    out.warnings.push("permissions should be an object; ignored");
    return out;
  }
  for (const effect of ["allow", "deny"] as const) {
    for (const token of strArray(perms[effect], `permissions.${effect}`, out.warnings)) {
      addCursorToken(token, effect, ctx, out);
    }
  }
  return out;
}

function addCursorToken(token: string, effect: "allow" | "deny", ctx: ParseContext, out: ParseResult): void {
  const shown = redactText(token);
  const m = /^\s*(Shell|Read|Write|WebFetch|Mcp)\((.*)\)\s*$/s.exec(token);
  if (!m) {
    out.warnings.push(`permissions.${effect}: unrecognized token "${shown}"`);
    out.permissions.push({ effect, capability: "other", rule: shown, broad: false });
    return;
  }
  const kind = m[1]!;
  const spec = (m[2] ?? "").trim();
  const isAll = spec === "*" || spec === "**" || spec === "" || spec === "**/*" || spec === "*:*";
  if (kind === "Shell") {
    out.permissions.push({ effect, capability: "shell", rule: shown, broad: isAll });
    if (effect === "allow") {
      // Cursor matches Shell(cmd) against the first word of a command, so a bare
      // program name allows it with any arguments.
      const effective = isAll ? null : /^\S+$/.test(spec) && !spec.includes(":") ? `${spec} *` : spec;
      const f = shellAllowFinding(shown, effective, ctx.scope, "Cursor");
      if (f) out.findings.push(f);
    }
  } else if (kind === "Read" || kind === "Write") {
    const outside = /^(\/|~|[A-Za-z]:)/.test(spec) && /\*\*/.test(spec);
    const broad = isAll || outside;
    out.permissions.push({ effect, capability: kind === "Read" ? "file-read" : "file-write", rule: shown, broad });
    if (effect === "allow" && kind === "Write" && broad) {
      out.findings.push({
        ruleId: "cursor.allow-all-writes",
        severity: "medium",
        subject: shown,
        title: "File writes are approved everywhere the rule reaches",
        explanation: outside
          ? "The pattern is an absolute path, so the Cursor agent can write outside the project without asking."
          : "The Cursor agent can create and modify any file in the workspace without asking, including scripts and CI files that run code later.",
        recommendation: "Scope write rules to the directories the agent should change.",
      });
    }
    if (effect === "allow" && kind === "Read" && outside) {
      out.findings.push({
        ruleId: "cursor.allow-reads-outside-project",
        severity: "medium",
        subject: shown,
        title: "Reads outside the project are approved",
        explanation: "An absolute-path read rule lets the Cursor agent read files such as SSH keys and cloud credentials without asking.",
        recommendation: "Keep read rules relative to the workspace.",
      });
    }
  } else if (kind === "WebFetch") {
    out.permissions.push({ effect, capability: "network", rule: shown, broad: spec === "*" });
    if (effect === "allow" && spec === "*") {
      out.findings.push({
        ruleId: "cursor.allow-all-fetch",
        severity: "medium",
        subject: shown,
        title: "Fetches to any domain are approved",
        explanation: "The Cursor agent can fetch any URL without asking; fetched pages are a common prompt-injection source and URLs can carry data out.",
        recommendation: "List the domains you need, for example `WebFetch(docs.example.com)`.",
      });
    }
  } else {
    const [server = "", tool = ""] = spec.split(":");
    const broad = server === "*" || tool === "*" || tool === "";
    out.permissions.push({ effect, capability: "mcp", rule: shown, broad });
    if (effect === "allow" && broad) {
      out.findings.push({
        ruleId: "cursor.allow-mcp-wildcard",
        severity: server === "*" ? "medium" : "low",
        subject: shown,
        title: server === "*" ? "Tools of every MCP server run without asking" : `Every tool of MCP server \`${server}\` runs without asking`,
        explanation: "Tools added later are approved automatically too, including ones that write data or call external services.",
        recommendation: "List individual tools, for example `Mcp(github:get_issue)`.",
      });
    }
  }
}
