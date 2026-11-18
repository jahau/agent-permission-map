import { bool, isObj, str, strArray, type Obj } from "./read.js";
import { isInlineSecret, redactArgs, redactText, redactUrl } from "./redact.js";
import { mcpServerFindings, type LocalFinding, type ServerFacts, type ServerSecrets } from "./risk.js";
import type { ParseResult, Scope, Transport } from "./types.js";

export type McpDialect = "claude" | "claude-desktop" | "cursor" | "vscode" | "gemini" | "codex" | "windsurf" | "copilot";

function normalizeTransport(type: string | undefined, hasCommand: boolean, hasUrl: boolean, warnings: string[], name: string): Transport {
  if (type !== undefined) {
    const t = type.toLowerCase();
    if (t === "stdio" || t === "local") return "stdio";
    if (t === "http" || t === "streamable-http" || t === "streamablehttp" || t === "streamable_http") return "http";
    if (t === "sse") return "sse";
    if (t === "ws" || t === "websocket") return "ws";
    if (t === "sdk") {
      warnings.push(`mcp server "${name}": type "sdk" servers are registered in-process by host apps and are skipped by the client when read from files`);
      return "unknown";
    }
    warnings.push(`mcp server "${name}": unknown transport type "${type}"`);
    return "unknown";
  }
  if (hasCommand) return "stdio";
  if (hasUrl) return "unknown";
  return "unknown";
}

/** Collect key names of a string map and detect literal secrets in its values. */
function mapKeys(v: unknown, field: string, name: string, warnings: string[], secretKeys: string[]): string[] {
  if (v === undefined) return [];
  if (!isObj(v)) {
    warnings.push(`mcp server "${name}": ${field} should be an object; ignored`);
    return [];
  }
  const keys = Object.keys(v).sort();
  for (const k of keys) {
    if (isInlineSecret(k, v[k])) secretKeys.push(`${field}.${k}`);
  }
  return keys;
}

export interface NormalizedServer {
  facts: ServerFacts;
  findings: LocalFinding[];
}

/**
 * Normalize one server entry. Unknown fields are ignored; wrong types become warnings.
 * Values of env and headers are never copied into the result.
 */
export function normalizeServer(
  name: string,
  raw: unknown,
  dialect: McpDialect,
  scope: Scope,
  warnings: string[],
  context?: string,
): NormalizedServer | null {
  if (!isObj(raw)) {
    warnings.push(`mcp server "${name}": entry should be an object; ignored`);
    return null;
  }
  const r: Obj = raw;
  const secretKeys: string[] = [];

  const command = str(r.command);
  if (r.command !== undefined && command === undefined) warnings.push(`mcp server "${name}": command should be a string`);
  const rawArgs = strArray(r.args, `mcp server "${name}": args`, warnings);
  const { args, redacted } = redactArgs(rawArgs);

  // URL field names differ by client.
  const urlRaw = str(r.url) ?? str(r.serverUrl) ?? str(r.httpUrl);
  let url: string | undefined;
  let urlHadCredentials = false;
  if (urlRaw !== undefined) {
    const ru = redactUrl(urlRaw);
    url = ru.url;
    urlHadCredentials = ru.hadCredentials;
  }

  let type = str(r.type) ?? str(r.transport);
  if (dialect === "gemini" && type === undefined) {
    if (str(r.httpUrl) !== undefined) type = "http";
    else if (str(r.url) !== undefined) type = "sse";
  }
  if (dialect === "codex" && type === undefined && url !== undefined && command === undefined) type = "http";
  if ((dialect === "windsurf" || dialect === "cursor" || dialect === "claude-desktop" || dialect === "copilot") && type === undefined && url !== undefined && command === undefined) {
    type = "http";
  }
  let transport = normalizeTransport(type, command !== undefined, url !== undefined, warnings, name);
  if (dialect === "claude" && type === undefined && url !== undefined && command === undefined) {
    warnings.push(`mcp server "${name}": has a url but no type; Claude Code reports this as a configuration error`);
  }
  if (transport === "stdio" && command === undefined) warnings.push(`mcp server "${name}": stdio server has no command`);
  if (transport !== "stdio" && transport !== "unknown" && url === undefined) warnings.push(`mcp server "${name}": remote server has no url`);
  if (transport === "unknown" && command !== undefined && type === undefined) transport = "stdio";

  const envKeys = mapKeys(r.env, "env", name, warnings, secretKeys);
  const headerKeys = [
    ...mapKeys(r.headers, "headers", name, warnings, secretKeys),
    ...mapKeys(r.http_headers, "http_headers", name, warnings, secretKeys),
  ];
  if (dialect === "codex") {
    // env_http_headers maps header -> env var name: names only, never secrets
    if (isObj(r.env_http_headers)) headerKeys.push(...Object.keys(r.env_http_headers));
    const bearer = str(r.bearer_token_env_var);
    if (bearer) headerKeys.push("Authorization");
    if (isObj(r.env_vars) || Array.isArray(r.env_vars)) {
      // forwarded variable names
      const names = Array.isArray(r.env_vars) ? r.env_vars.filter((x): x is string => typeof x === "string") : Object.keys(r.env_vars as Obj);
      envKeys.push(...names);
    }
  }
  // Cursor remote OAuth block
  if (isObj(r.auth) && isInlineSecret("CLIENT_SECRET", r.auth.CLIENT_SECRET)) secretKeys.push("auth.CLIENT_SECRET");
  if (isObj(r.oauth) && isInlineSecret("clientSecret", r.oauth.clientSecret)) secretKeys.push("oauth.clientSecret");

  const envFile = str(r.envFile);
  const cwd = str(r.cwd);

  let enabled = true;
  if (bool(r.disabled) === true) enabled = false;
  if (bool(r.enabled) === false) enabled = false;

  let autoApprove: ServerFacts["autoApprove"] = "unspecified";
  let toolsAllowed: string[] | undefined;
  let toolsDenied: string[] | undefined;
  if (dialect === "gemini") {
    autoApprove = bool(r.trust) === true ? "all" : "none";
    if (r.includeTools !== undefined) toolsAllowed = strArray(r.includeTools, `mcp server "${name}": includeTools`, warnings).sort();
    if (r.excludeTools !== undefined) toolsDenied = strArray(r.excludeTools, `mcp server "${name}": excludeTools`, warnings).sort();
  } else if (dialect === "codex") {
    if (r.enabled_tools !== undefined) toolsAllowed = strArray(r.enabled_tools, `mcp server "${name}": enabled_tools`, warnings).sort();
    if (r.disabled_tools !== undefined) toolsDenied = strArray(r.disabled_tools, `mcp server "${name}": disabled_tools`, warnings).sort();
  } else {
    // Cline / Roo / Windsurf style auto-approve lists
    const list = r.alwaysAllow ?? r.autoApprove;
    if (list !== undefined) {
      const tools = strArray(list, `mcp server "${name}": ${r.alwaysAllow !== undefined ? "alwaysAllow" : "autoApprove"}`, warnings);
      if (tools.includes("*")) autoApprove = "all";
      else if (tools.length > 0) autoApprove = "some";
      else autoApprove = "none";
    }
    if (r.disabledTools !== undefined) toolsDenied = strArray(r.disabledTools, `mcp server "${name}": disabledTools`, warnings).sort();
  }

  const facts: ServerFacts = {
    name,
    transport,
    args,
    envKeys: [...new Set(envKeys)].sort(),
    headerKeys: [...new Set(headerKeys)].sort(),
    enabled,
    autoApprove,
  };
  if (command !== undefined) facts.command = redactText(command);
  if (url !== undefined) facts.url = url;
  if (cwd !== undefined) facts.cwd = cwd;
  if (envFile !== undefined) facts.envFile = envFile;
  if (toolsAllowed) facts.toolsAllowed = toolsAllowed;
  if (toolsDenied) facts.toolsDenied = toolsDenied;
  if (context) facts.context = context;

  const secrets: ServerSecrets = { inlineSecretKeys: secretKeys.sort(), argsRedacted: redacted, urlHadCredentials };
  return { facts, findings: mcpServerFindings(facts, secrets, scope) };
}

/** Parse a `{ "<name>": {...} }` map of servers into a result. */
export function addServerMap(
  map: unknown,
  field: string,
  dialect: McpDialect,
  scope: Scope,
  result: ParseResult,
  context?: string,
): void {
  if (map === undefined) return;
  if (!isObj(map)) {
    result.warnings.push(`${field} should be an object; ignored`);
    return;
  }
  for (const name of Object.keys(map).sort()) {
    const n = normalizeServer(name, map[name], dialect, scope, result.warnings, context);
    if (!n) continue;
    result.mcpServers.push(n.facts);
    result.findings.push(...n.findings);
  }
}
