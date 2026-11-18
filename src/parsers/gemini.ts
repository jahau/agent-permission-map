import { addServerMap } from "../mcp.js";
import { bool, isObj, scalar, str, strArray, type Obj } from "../read.js";
import { redactText } from "../redact.js";
import { shellAllowFinding } from "../risk.js";
import { emptyResult, type Capability, type ParseContext, type ParseResult } from "../types.js";

const SHELL_TOOLS = new Set(["run_shell_command", "ShellTool"]);
const WRITE_TOOLS = new Set(["write_file", "replace", "edit", "WriteFileTool", "EditTool"]);
const READ_TOOLS = new Set(["read_file", "read_many_files", "glob", "search_file_content", "list_directory", "ReadFileTool", "GlobTool", "GrepTool", "LSTool", "ReadManyFilesTool"]);
const NET_TOOLS = new Set(["web_fetch", "google_web_search", "WebFetchTool", "WebSearchTool"]);

function capabilityOf(tool: string): Capability {
  if (SHELL_TOOLS.has(tool)) return "shell";
  if (WRITE_TOOLS.has(tool)) return "file-write";
  if (READ_TOOLS.has(tool)) return "file-read";
  if (NET_TOOLS.has(tool)) return "network";
  return "tool";
}

function splitTool(entry: string): { tool: string; spec: string | null } {
  const m = /^\s*([A-Za-z0-9_.-]+)\s*(?:\((.*)\))?\s*$/s.exec(entry);
  if (!m || !m[1]) return { tool: entry.trim(), spec: null };
  return { tool: m[1], spec: m[2] === undefined ? null : m[2] };
}

/** `~/.gemini/settings.json`, `.gemini/settings.json`, system settings. Supports nested (v0.3+) and legacy flat keys. */
export function parseGeminiSettings(data: unknown, ctx: ParseContext): ParseResult {
  const out = emptyResult();
  if (!isObj(data)) {
    out.warnings.push("top level should be a JSON object; nothing analyzed");
    return out;
  }
  const tools: Obj = isObj(data.tools) ? data.tools : {};
  const general: Obj = isObj(data.general) ? data.general : {};
  const security: Obj = isObj(data.security) ? data.security : {};
  const mcp: Obj = isObj(data.mcp) ? data.mcp : {};

  const legacy = ["coreTools", "excludeTools", "allowedTools", "autoAccept", "allowMCPServers", "excludeMCPServers"].filter((k) => data[k] !== undefined);
  if (legacy.length > 0) out.warnings.push(`legacy flat settings keys found (${legacy.join(", ")}); newer Gemini CLI versions expect nested categories`);

  const allowed = [
    ...strArray(tools.allowed, "tools.allowed", out.warnings),
    ...strArray(data.allowedTools, "allowedTools", out.warnings),
  ];
  for (const entry of allowed) {
    const { tool, spec } = splitTool(entry);
    const capability = capabilityOf(tool);
    const shown = redactText(entry);
    out.permissions.push({ effect: "allow", capability, rule: shown, broad: spec === null });
    if (capability === "shell") {
      const f = shellAllowFinding(shown, spec, ctx.scope, "Gemini CLI");
      if (f) out.findings.push(f);
    } else if (capability === "file-write" && spec === null) {
      out.findings.push({
        ruleId: "gemini.allow-all-writes",
        severity: "medium",
        subject: shown,
        title: "File writes run without confirmation",
        explanation: "Gemini CLI writes or edits files without asking, including scripts and CI files that run code later.",
        recommendation: "Use `general.defaultApprovalMode: \"auto_edit\"` per session instead of a standing allow rule, or remove the rule.",
      });
    }
  }
  for (const entry of strArray(tools.confirmationRequired, "tools.confirmationRequired", out.warnings)) {
    const { tool } = splitTool(entry);
    out.permissions.push({ effect: "ask", capability: capabilityOf(tool), rule: redactText(entry), broad: false });
  }
  for (const entry of [...strArray(tools.exclude, "tools.exclude", out.warnings), ...strArray(data.excludeTools, "excludeTools", out.warnings)]) {
    const { tool, spec } = splitTool(entry);
    out.permissions.push({ effect: "deny", capability: capabilityOf(tool), rule: redactText(entry), broad: spec === null });
  }
  const core = tools.core ?? data.coreTools;
  if (core !== undefined) {
    const list = strArray(core, "tools.core", out.warnings);
    out.posture.push({ key: "tools.core", value: list.length === 0 ? "[] (all built-in tools)" : list.slice().sort().join(", ") });
  }

  const mode = str(general.defaultApprovalMode);
  if (general.defaultApprovalMode !== undefined) out.posture.push({ key: "general.defaultApprovalMode", value: scalar(general.defaultApprovalMode) });
  if (mode === "yolo") {
    out.findings.push({
      ruleId: "gemini.mode-yolo",
      severity: "critical",
      subject: "general.defaultApprovalMode = yolo",
      title: "Settings request YOLO mode",
      explanation: "YOLO approves every tool call, shell commands included. Gemini CLI documents YOLO as command-line only, so the value may be ignored, but older versions or wrappers may honor it.",
      recommendation: "Remove the value; use `--yolo` only inside a sandbox.",
    });
  } else if (mode === "auto_edit") {
    out.findings.push({
      ruleId: "gemini.mode-auto-edit",
      severity: "low",
      subject: "general.defaultApprovalMode = auto_edit",
      title: "File edits are approved automatically",
      explanation: "Edit tools run without a prompt in every session. Edits to build scripts or CI files can lead to code running later.",
      recommendation: "Use the default mode for repositories you do not control.",
    });
  } else if (mode !== undefined && !["default", "plan"].includes(mode)) {
    out.warnings.push(`general.defaultApprovalMode has an unrecognized value "${mode}"`);
  }
  if (bool(tools.autoAccept) === true || bool(data.autoAccept) === true) {
    out.posture.push({ key: "tools.autoAccept", value: true });
    out.findings.push({
      ruleId: "gemini.auto-accept",
      severity: "low",
      subject: "autoAccept = true",
      title: "Tool calls considered safe are approved automatically",
      explanation: "Gemini CLI skips confirmation for tool calls it classifies as safe (typically read-only).",
      recommendation: "Keep it off for repositories you do not control.",
    });
  }

  for (const key of ["sandbox", "sandboxNetworkAccess"]) {
    if (tools[key] !== undefined) out.posture.push({ key: `tools.${key}`, value: scalar(tools[key]) });
  }
  if (data.sandbox !== undefined) out.posture.push({ key: "sandbox", value: scalar(data.sandbox) });
  for (const key of ["disableYoloMode", "disableAlwaysAllow", "toolSandboxing", "blockGitExtensions"]) {
    if (security[key] !== undefined) out.posture.push({ key: `security.${key}`, value: scalar(security[key]) });
  }
  if (isObj(security.folderTrust) && security.folderTrust.enabled !== undefined) {
    out.posture.push({ key: "security.folderTrust.enabled", value: scalar(security.folderTrust.enabled) });
    if (security.folderTrust.enabled === false) {
      out.findings.push({
        ruleId: "gemini.folder-trust-disabled",
        severity: "medium",
        subject: "security.folderTrust.enabled = false",
        title: "Folder trust is turned off",
        explanation: "Project settings, including MCP servers and tool allow lists from `.gemini/settings.json`, load in every folder without a trust decision.",
        recommendation: "Re-enable folder trust.",
      });
    }
  }
  for (const key of ["allowed", "excluded"]) {
    for (const name of strArray(mcp[key], `mcp.${key}`, out.warnings).sort()) out.posture.push({ key: `mcp.${key}`, value: name });
  }
  for (const key of ["allowMCPServers", "excludeMCPServers"]) {
    for (const name of strArray(data[key], key, out.warnings).sort()) out.posture.push({ key, value: name });
  }

  addServerMap(data.mcpServers, "mcpServers", "gemini", ctx.scope, out);
  return out;
}
