import { addServerMap } from "../mcp.js";
import { bool, isObj, scalar, str, type Obj } from "../read.js";
import { emptyResult, type ParseContext, type ParseResult } from "../types.js";

/** Analyze one layer: the top level of config.toml or one `[profiles.<name>]` table. */
function analyzeLayer(layer: Obj, out: ParseResult, context?: string): void {
  const ctxNote = context ? ` (${context})` : "";
  const extra = context ? { context } : {};
  const approvalRaw = layer.approval_policy;
  let approval: string | undefined = str(approvalRaw);
  if (approvalRaw !== undefined) {
    if (isObj(approvalRaw)) approval = "granular";
    out.posture.push({ key: "approval_policy", value: approval ?? scalar(approvalRaw), ...extra });
  }
  const sandbox = str(layer.sandbox_mode);
  if (layer.sandbox_mode !== undefined) out.posture.push({ key: "sandbox_mode", value: scalar(layer.sandbox_mode), ...extra });
  if (sandbox !== undefined && !["read-only", "workspace-write", "danger-full-access"].includes(sandbox)) {
    out.warnings.push(`sandbox_mode has an unrecognized value "${sandbox}"${ctxNote}`);
  }
  if (approval !== undefined && !["on-request", "never", "untrusted", "on-failure", "granular"].includes(approval)) {
    out.warnings.push(`approval_policy has an unrecognized value "${approval}"${ctxNote}`);
  }
  if (approval === "on-failure") out.warnings.push(`approval_policy "on-failure" is deprecated${ctxNote}`);

  if (sandbox === "danger-full-access") {
    const never = approval === "never";
    out.findings.push({
      ruleId: "codex.sandbox-full-access",
      severity: never ? "critical" : "high",
      subject: `sandbox_mode = danger-full-access${never ? ", approval_policy = never" : ""}${ctxNote}`,
      title: never ? "No sandbox and no approvals" : "Sandbox disabled",
      explanation: never
        ? "Codex runs every command with full filesystem and network access and never asks first. Any prompt injection becomes code execution as your user."
        : "Commands run without the Codex sandbox, with full filesystem and network access. Only the approval prompt stands between the model and your machine.",
      recommendation: "Use `workspace-write` (the default sandbox) and reserve `danger-full-access` for disposable containers.",
    });
  } else if (approval === "never" && sandbox !== "read-only") {
    out.findings.push({
      ruleId: "codex.approval-never",
      severity: "medium",
      subject: `approval_policy = never${ctxNote}`,
      title: "Codex never asks before running commands",
      explanation: "Within the sandbox, commands run without any approval prompt, and failures are not escalated to you. The sandbox still limits writes to the workspace" + (sandbox === undefined ? " if the default sandbox applies." : "."),
      recommendation: "Use `on-request` for interactive work; keep `never` for CI runs in disposable environments.",
    });
  }

  const sww = layer.sandbox_workspace_write;
  if (sww !== undefined && !isObj(sww)) out.warnings.push(`sandbox_workspace_write should be a table${ctxNote}`);
  if (isObj(sww)) {
    if (sww.network_access !== undefined) out.posture.push({ key: "sandbox_workspace_write.network_access", value: scalar(sww.network_access), ...extra });
    if (bool(sww.network_access) === true) {
      out.permissions.push({ effect: "allow", capability: "network", rule: "sandbox_workspace_write.network_access = true", broad: true, ...extra });
      out.findings.push({
        ruleId: "codex.sandbox-network",
        severity: "medium",
        subject: `sandbox_workspace_write.network_access = true${ctxNote}`,
        title: "Sandboxed commands can reach the network",
        explanation: "Commands inside the sandbox may open outbound connections, so a prompt-injected command can upload workspace files or fetch and run code.",
        recommendation: "Leave network access off and allow it per task.",
      });
    }
    if (Array.isArray(sww.writable_roots)) {
      for (const root of sww.writable_roots) {
        if (typeof root !== "string") continue;
        const broad = /^(\/|~|~\/|[A-Za-z]:[\\/]?|\/(home|Users)\/[^/]+\/?)$/.test(root.trim());
        out.permissions.push({ effect: "allow", capability: "directory", rule: `writable_roots: ${root}`, broad, ...extra });
        if (broad) {
          out.findings.push({
            ruleId: "codex.writable-root-broad",
            severity: "high",
            subject: `writable_roots: ${root}${ctxNote}`,
            title: "Sandbox can write to your home directory or filesystem root",
            explanation: "This writable root removes most of the protection the workspace-write sandbox provides: commands can change shell profiles, SSH config and other files that run code later.",
            recommendation: "List only the extra directories the project needs.",
          });
        }
      }
    }
  }

  const sep = layer.shell_environment_policy;
  if (isObj(sep) && sep.inherit !== undefined) {
    out.posture.push({ key: "shell_environment_policy.inherit", value: scalar(sep.inherit), ...extra });
  }
}

/** `~/.codex/config.toml` and `.codex/config.toml`. */
export function parseCodexConfig(data: unknown, ctx: ParseContext): ParseResult {
  const out = emptyResult();
  if (!isObj(data)) {
    out.warnings.push("top level should be a table; nothing analyzed");
    return out;
  }
  analyzeLayer(data, out);
  if (ctx.scope === "project") {
    for (const key of ["profile", "profiles", "model_provider", "model_providers", "notify", "otel"]) {
      if (data[key] !== undefined) out.warnings.push(`"${key}" is ignored in project config files; set it in ~/.codex/config.toml`);
    }
  }
  if (data.profiles !== undefined && !isObj(data.profiles)) out.warnings.push("profiles should be a table; ignored");
  if (isObj(data.profiles)) {
    for (const name of Object.keys(data.profiles).sort()) {
      const p = data.profiles[name];
      if (isObj(p)) analyzeLayer(p, out, `profile: ${name}`);
    }
  }
  if (str(data.profile)) out.posture.push({ key: "profile", value: str(data.profile)! });
  addServerMap(data.mcp_servers, "mcp_servers", "codex", ctx.scope, out);
  return out;
}
