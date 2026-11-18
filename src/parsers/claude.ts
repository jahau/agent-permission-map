import { addServerMap } from "../mcp.js";
import { bool, isObj, objKeys, scalar, str, strArray, type Obj } from "../read.js";
import { isInlineSecret, redactText } from "../redact.js";
import { shellAllowFinding } from "../risk.js";
import { emptyResult, type Capability, type Effect, type ParseContext, type ParseResult } from "../types.js";
import { normalizeFsPath, samePath } from "../paths.js";

const LABEL = "Claude Code";

export interface ParsedClaudeRule {
  tool: string;
  spec: string | null;
  capability: Capability;
  broad: boolean;
}

/** Parse `Tool` or `Tool(spec)`. Returns null for text that is not a rule. */
export function parseClaudeRule(rule: string): ParsedClaudeRule | null {
  const m = /^\s*([A-Za-z0-9_*.:-]+)\s*(?:\((.*)\))?\s*$/s.exec(rule);
  if (!m || !m[1]) return null;
  const tool = m[1];
  const spec = m[2] === undefined ? null : m[2];
  let capability: Capability = "tool";
  if (tool === "*") capability = "all";
  else if (tool === "Bash" || tool === "PowerShell") capability = "shell";
  else if (tool === "Read" || tool === "Grep" || tool === "Glob" || tool === "LS") capability = "file-read";
  else if (tool === "Edit" || tool === "Write" || tool === "MultiEdit" || tool === "NotebookEdit") capability = "file-write";
  else if (tool === "WebFetch" || tool === "WebSearch") capability = "network";
  else if (tool.startsWith("mcp__")) capability = "mcp";
  const s = spec?.trim() ?? null;
  let broad = s === null || s === "*" || s === "**" || s === "domain:*";
  if (capability === "mcp") broad = tool === "mcp__*" || tool.endsWith("__*") || !tool.slice(5).includes("__");
  if (capability === "file-read" || capability === "file-write") {
    if (s !== null && /^(\/\/|~\/?)?\*\*(\/\*)?$/.test(s)) broad = true;
    if (s === "/**" || s === "//**" || s === "~/**") broad = true;
  }
  return { tool, spec, capability, broad };
}

function ruleFindings(rule: string, parsed: ParsedClaudeRule, effect: Effect, ctx: ParseContext, out: ParseResult): void {
  if (effect !== "allow") return;
  const shared = ctx.scope === "project" ? " This file is committed with the repository, so the rule applies to everyone who trusts the folder." : "";
  if (parsed.capability === "all") {
    out.findings.push({
      ruleId: "claude.allow-wildcard-tool",
      severity: "info",
      subject: rule,
      title: "Unanchored wildcard allow rule is ignored",
      explanation: "Claude Code skips allow rules whose tool name is a bare glob such as `*`, so this rule auto-approves nothing. It may reflect an intent to allow everything.",
      recommendation: "Remove the rule, or replace it with the specific tools you want to allow.",
    });
    return;
  }
  if (parsed.capability === "shell") {
    const f = shellAllowFinding(rule, parsed.spec, ctx.scope, LABEL);
    if (f) out.findings.push(f);
    return;
  }
  if (parsed.capability === "file-write" && parsed.broad) {
    out.findings.push({
      ruleId: "claude.allow-all-writes",
      severity: "medium",
      subject: rule,
      title: "File edits are approved everywhere the rule reaches",
      explanation: `Claude Code can create and modify files without asking, including build scripts, CI workflows and git hooks that later run code.${shared}`,
      recommendation: "Prefer `acceptEdits` mode for a session, or scope the rule to source directories (for example `Edit(./src/**)`).",
    });
    return;
  }
  if (parsed.capability === "file-read" && parsed.spec !== null && /^(\/\/|~)/.test(parsed.spec.trim()) && parsed.broad) {
    out.findings.push({
      ruleId: "claude.allow-reads-outside-project",
      severity: "medium",
      subject: rule,
      title: "Reads outside the project are approved",
      explanation: "The rule lets Claude Code read files across your home directory or the whole filesystem without asking, including SSH keys, cloud credentials and browser data.",
      recommendation: "Limit read rules to the project or to specific directories, and add deny rules for credential paths.",
    });
    return;
  }
  if (parsed.capability === "network" && parsed.tool === "WebFetch" && parsed.broad) {
    out.findings.push({
      ruleId: "claude.allow-all-fetch",
      severity: "medium",
      subject: rule,
      title: "Fetches to any domain are approved",
      explanation: `Claude Code can request any URL without asking. Data can be sent out in the URL itself, and fetched pages are a common prompt-injection source.${shared}`,
      recommendation: "Allow specific domains with `WebFetch(domain:example.com)`.",
    });
    return;
  }
  if (parsed.capability === "mcp" && parsed.broad) {
    if (parsed.tool === "mcp__*") {
      out.findings.push({
        ruleId: "claude.allow-wildcard-tool",
        severity: "info",
        subject: rule,
        title: "Unanchored MCP wildcard allow rule is ignored",
        explanation: "Claude Code only honors MCP allow globs after a literal `mcp__<server>__` prefix, so `mcp__*` auto-approves nothing.",
        recommendation: "Name the server: `mcp__<server>__*`, or better, individual tools.",
      });
      return;
    }
    const server = parsed.tool.replace(/^mcp__/, "").replace(/__\*$/, "");
    out.findings.push({
      ruleId: "claude.allow-mcp-server",
      severity: "low",
      subject: rule,
      title: `Every tool of MCP server \`${server}\` runs without asking`,
      explanation: "Tools added to the server later are approved automatically too, including ones that write data or call external services.",
      recommendation: `List the specific tools instead (for example \`mcp__${server}__search\`).`,
    });
  }
}

function addRules(list: unknown, effect: Effect, ctx: ParseContext, out: ParseResult): void {
  for (const rule of strArray(list, `permissions.${effect}`, out.warnings)) {
    const parsed = parseClaudeRule(rule);
    const shown = redactText(rule);
    if (!parsed) {
      out.warnings.push(`permissions.${effect}: could not parse rule "${shown}"`);
      out.permissions.push({ effect, capability: "other", rule: shown, broad: false });
      continue;
    }
    if (parsed.tool.startsWith("mcp__") && parsed.spec !== null) {
      out.warnings.push(`permissions.${effect}: Claude Code skips mcp__ rules with parentheses ("${shown}")`);
    }
    out.permissions.push({ effect, capability: parsed.capability, rule: shown, broad: parsed.broad });
    ruleFindings(shown, parsed, effect, ctx, out);
  }
}

const HOME_OR_ROOT = /^(\/|~|~\/|\$HOME|[A-Za-z]:[\\/]?|\/(home|Users)\/[^/]+\/?|[A-Za-z]:[\\/]Users[\\/][^\\/]+[\\/]?)$/;

/** settings.json, settings.local.json, managed-settings.json */
export function parseClaudeSettings(data: unknown, ctx: ParseContext): ParseResult {
  const out = emptyResult();
  if (!isObj(data)) {
    out.warnings.push("top level should be a JSON object; nothing analyzed");
    return out;
  }
  const perms = data.permissions;
  if (perms !== undefined && !isObj(perms)) out.warnings.push("permissions should be an object; ignored");
  if (isObj(perms)) {
    addRules(perms.allow, "allow", ctx, out);
    addRules(perms.ask, "ask", ctx, out);
    addRules(perms.deny, "deny", ctx, out);
    for (const dir of strArray(perms.additionalDirectories, "permissions.additionalDirectories", out.warnings)) {
      out.permissions.push({ effect: "allow", capability: "directory", rule: dir, broad: HOME_OR_ROOT.test(dir.trim()) });
      if (HOME_OR_ROOT.test(dir.trim())) {
        out.findings.push({
          ruleId: "claude.additional-directory-broad",
          severity: "high",
          subject: dir,
          title: "Home directory or filesystem root added as a working directory",
          explanation: "Claude Code treats additional directories like the project: it reads them without asking and, in `acceptEdits` mode, edits them. This one covers your whole home directory or drive.",
          recommendation: "Add only the specific directories the project needs.",
        });
      }
    }
    const mode = str(perms.defaultMode);
    if (perms.defaultMode !== undefined) {
      out.posture.push({ key: "permissions.defaultMode", value: scalar(perms.defaultMode) });
      if (mode === undefined) out.warnings.push("permissions.defaultMode should be a string");
    }
    if (mode === "bypassPermissions") {
      const ignored = ctx.scope === "project" || ctx.scope === "local";
      out.findings.push({
        ruleId: "claude.mode-bypass",
        severity: ignored ? "high" : "critical",
        subject: "permissions.defaultMode = bypassPermissions",
        title: "Sessions start with permission prompts disabled",
        explanation: ignored
          ? "This file asks every session to start in `bypassPermissions` mode. Current Claude Code versions (v2.1.257 and later) ignore this value in project and local files, but older versions honor it, and the intent is worth removing from a shared file."
          : "Every session starts in `bypassPermissions` mode: Claude Code runs commands, edits files (including `.git` and `.claude`) and calls tools without asking. Anthropic recommends this only inside isolated containers or VMs.",
        recommendation: "Remove the setting and use `--permission-mode bypassPermissions` only for sessions inside a sandbox. Consider `permissions.disableBypassPermissionsMode: \"disable\"`.",
      });
    } else if (mode === "auto") {
      out.findings.push({
        ruleId: "claude.mode-auto",
        severity: ctx.scope === "project" || ctx.scope === "local" ? "low" : "medium",
        subject: "permissions.defaultMode = auto",
        title: "Sessions start in auto mode",
        explanation: "Routine actions run without prompts; a background classifier decides whether shell commands and network requests match your request. A classifier lowers, but does not remove, the risk of a prompt-injected action running.",
        recommendation: "Keep deny rules for destructive and network commands; they still apply in auto mode.",
      });
    } else if (mode === "acceptEdits") {
      out.findings.push({
        ruleId: "claude.mode-accept-edits",
        severity: "low",
        subject: "permissions.defaultMode = acceptEdits",
        title: "File edits are accepted without asking",
        explanation: "File edits and common filesystem commands in the working directories run without a prompt. Edits to build scripts or CI files can lead to code running later.",
        recommendation: "Review diffs before running builds, or use the default mode for untrusted repositories.",
      });
    } else if (mode !== undefined && !["default", "plan", "dontAsk", "manual"].includes(mode)) {
      out.warnings.push(`permissions.defaultMode has an unrecognized value "${mode}"`);
    }
    for (const key of ["disableBypassPermissionsMode", "disableAutoMode", "denyInsteadOfPrompting", "blockReadsOutsideWorkingDirectories", "blockWritesOutsideWorkingDirectories"]) {
      if (perms[key] !== undefined) out.posture.push({ key: `permissions.${key}`, value: scalar(perms[key]) });
    }
  }

  if (data.allowManagedPermissionRulesOnly !== undefined) out.posture.push({ key: "allowManagedPermissionRulesOnly", value: scalar(data.allowManagedPermissionRulesOnly) });

  // MCP approval settings
  if (bool(data.enableAllProjectMcpServers) === true) {
    out.posture.push({ key: "enableAllProjectMcpServers", value: true });
    out.findings.push({
      ruleId: "claude.enable-all-project-mcp",
      severity: ctx.scope === "user" || ctx.scope === "managed" ? "high" : "medium",
      subject: "enableAllProjectMcpServers = true",
      title: "MCP servers from project files are approved automatically",
      explanation: ctx.scope === "user" || ctx.scope === "managed"
        ? "Any repository you open with a `.mcp.json` file can start its servers without the per-server approval prompt. A cloned repository can therefore launch local commands as soon as the folder is trusted."
        : "Every server in this project's `.mcp.json` starts without its approval prompt once the folder is trusted, including servers added by later commits.",
      recommendation: "Remove the setting and approve servers by name with `enabledMcpjsonServers`.",
    });
  } else if (data.enableAllProjectMcpServers !== undefined) {
    out.posture.push({ key: "enableAllProjectMcpServers", value: scalar(data.enableAllProjectMcpServers) });
  }
  for (const key of ["enabledMcpjsonServers", "disabledMcpjsonServers"]) {
    for (const name of strArray(data[key], key, out.warnings).sort()) {
      out.posture.push({ key, value: name });
    }
  }
  for (const key of ["allowedMcpServers", "deniedMcpServers"]) {
    const v = data[key];
    if (v === undefined) continue;
    if (!Array.isArray(v)) {
      out.warnings.push(`${key} should be an array; ignored`);
      continue;
    }
    for (const entry of v) {
      if (!isObj(entry)) continue;
      const label = str(entry.serverName) ?? (Array.isArray(entry.serverCommand) ? entry.serverCommand.filter((x) => typeof x === "string").join(" ") : undefined) ?? str(entry.serverUrl);
      if (label) out.posture.push({ key, value: redactText(label) });
    }
  }
  if (Array.isArray(data.allowedMcpServers) && data.allowedMcpServers.length === 0) out.posture.push({ key: "allowedMcpServers", value: "[] (no MCP servers allowed)" });

  // Hooks run commands automatically.
  if (data.hooks !== undefined) parseHooks(data.hooks, ctx, out);
  if (data.disableAllHooks !== undefined) out.posture.push({ key: "disableAllHooks", value: scalar(data.disableAllHooks) });

  // Environment passed to every session.
  const envKeys = objKeys(data.env, "env", out.warnings);
  for (const k of envKeys) {
    out.posture.push({ key: "env", value: k });
    if (isInlineSecret(k, (data.env as Obj)[k])) {
      out.findings.push({
        ruleId: "claude.env-inline-secret",
        severity: ctx.scope === "project" ? "critical" : "high",
        subject: `env.${k}`,
        title: "Credential written directly in settings",
        explanation: `\`env.${k}\` looks like a literal credential${ctx.scope === "project" ? " in a settings file meant to be committed" : ""}. Claude Code passes it to every session and to the commands it runs. The value is not shown in this report.`,
        recommendation: "Set the variable in your shell or a secret manager instead, and rotate the credential.",
      });
    }
  }

  for (const key of ["apiKeyHelper", "awsAuthRefresh", "awsCredentialExport", "otelHeadersHelper"]) {
    const v = str(data[key]);
    if (v === undefined) continue;
    out.posture.push({ key, value: redactText(v) });
    if (ctx.scope === "project") {
      out.findings.push({
        ruleId: "claude.credential-helper-in-project",
        severity: "medium",
        subject: key,
        title: "Repository settings define a credential helper command",
        explanation: `\`${key}\` is a shell command Claude Code runs to obtain credentials. Defined in a shared project file, it is code from the repository that runs with access to your credentials.`,
        recommendation: "Define credential helpers in user or managed settings only.",
      });
    }
  }

  const sandbox = data.sandbox;
  if (isObj(sandbox)) {
    for (const key of ["enabled", "autoAllowBashIfSandboxed", "allowUnsandboxedCommands"]) {
      if (sandbox[key] !== undefined) out.posture.push({ key: `sandbox.${key}`, value: scalar(sandbox[key]) });
    }
    if (isObj(sandbox.network)) {
      for (const d of strArray(sandbox.network.allowedDomains, "sandbox.network.allowedDomains", out.warnings)) {
        out.permissions.push({ effect: "allow", capability: "network", rule: `sandbox.network: ${d}`, broad: d === "*" });
      }
    }
  }

  if (data.mcpServers !== undefined) addServerMap(data.mcpServers, "mcpServers", "claude", ctx.scope, out);
  return out;
}

function parseHooks(hooks: unknown, ctx: ParseContext, out: ParseResult): void {
  if (!isObj(hooks)) {
    out.warnings.push("hooks should be an object; ignored");
    return;
  }
  for (const event of Object.keys(hooks).sort()) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) {
      out.warnings.push(`hooks.${event} should be an array; ignored`);
      continue;
    }
    for (const group of groups) {
      if (!isObj(group)) continue;
      const matcher = str(group.matcher);
      const list = Array.isArray(group.hooks) ? group.hooks : [];
      for (const h of list) {
        if (!isObj(h)) continue;
        const type = str(h.type) ?? "command";
        const command = redactText(str(h.command) ?? str(h.url) ?? str(h.prompt) ?? "");
        const hook = { event, type, command, ...(matcher !== undefined ? { matcher } : {}) };
        out.hooks.push(hook);
        if (type === "command" && command !== "") {
          const shared = ctx.scope === "project";
          out.findings.push({
            ruleId: "claude.hook-command",
            severity: shared ? "medium" : "info",
            subject: `${event}${matcher ? ` [${matcher}]` : ""}: ${truncate(command, 80)}`,
            title: shared ? "Repository settings run a shell command automatically" : "Hook runs a shell command automatically",
            explanation: shared
              ? `On \`${event}\`, Claude Code runs this command with your user's permissions, without a prompt, once the folder is trusted. Anyone who can change this file can change what runs.`
              : `On \`${event}\`, Claude Code runs this command without a prompt. Hooks are not limited by permission rules.`,
            recommendation: shared ? "Review the command and the script it calls; keep such hooks small and in-repo." : "Confirm the command is one you added and still need.",
          });
        }
      }
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/**
 * ~/.claude.json: only `mcpServers` (user scope) and `projects[<this project>].mcpServers`
 * (local scope) are read. Account details and other projects' entries are ignored.
 */
export function parseClaudeGlobal(data: unknown, ctx: ParseContext): ParseResult {
  const out = emptyResult();
  if (!isObj(data)) {
    out.warnings.push("top level should be a JSON object; nothing analyzed");
    return out;
  }
  addServerMap(data.mcpServers, "mcpServers", "claude", "user", out, "user scope");
  if (data.projects !== undefined && !isObj(data.projects)) out.warnings.push("projects should be an object; ignored");
  if (isObj(data.projects) && ctx.projectRoot) {
    const want = normalizeFsPath(ctx.projectRoot);
    for (const key of Object.keys(data.projects).sort()) {
      if (!samePath(normalizeFsPath(key), want)) continue;
      const proj = data.projects[key];
      if (!isObj(proj)) continue;
      addServerMap(proj.mcpServers, "projects[<this project>].mcpServers", "claude", "local", out, "local scope");
      for (const k of ["enabledMcpjsonServers", "disabledMcpjsonServers"]) {
        for (const name of strArray(proj[k], k, out.warnings).sort()) out.posture.push({ key: k, value: name, context: "local scope" });
      }
      const allowed = proj.allowedTools;
      for (const rule of strArray(allowed, "projects[<this project>].allowedTools", out.warnings)) {
        const parsed = parseClaudeRule(rule);
        const shown = redactText(rule);
        out.permissions.push({ effect: "allow", capability: parsed?.capability ?? "other", rule: shown, broad: parsed?.broad ?? false, context: "legacy allowedTools" });
        if (parsed) ruleFindings(shown, parsed, "allow", { ...ctx, scope: "local" }, out);
      }
    }
  }
  return out;
}
