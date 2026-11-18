import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeFixture } from "./helpers.js";

const ids = (fs: { ruleId: string }[]) => fs.map((f) => f.ruleId).sort();

test("claude settings: rules, modes, MCP approvals, hooks, sandbox", async () => {
  const r = await analyzeFixture("claude-settings.json", "claude-settings", "claude-code", "user");
  assert.equal(r.status, "parsed");
  const { permissions, posture, hooks, warnings, findings } = r.result;
  assert.deepEqual(warnings, []);
  const byEffect = (e: string) => permissions.filter((p) => p.effect === e && p.capability !== "directory" && !p.rule.startsWith("sandbox")).map((p) => p.rule);
  assert.equal(byEffect("allow").length, 5);
  assert.deepEqual(byEffect("ask"), ["Bash(git push *)"]);
  assert.equal(byEffect("deny").length, 5);
  assert.equal(permissions.find((p) => p.rule === "mcp__*")?.capability, "mcp");
  assert.equal(permissions.find((p) => p.rule === "WebFetch(domain:github.com)")?.broad, false);
  assert.equal(permissions.find((p) => p.capability === "directory")?.rule, "../docs/");
  assert.ok(permissions.some((p) => p.rule === "sandbox.network: github.com"));
  const keys = posture.map((p) => `${p.key}=${p.value}`);
  for (const k of ["permissions.defaultMode=plan", "permissions.disableBypassPermissionsMode=disable", "enabledMcpjsonServers=github", "disabledMcpjsonServers=filesystem", "env=CLAUDE_CODE_ENABLE_TELEMETRY", "apiKeyHelper=/bin/generate_temp_api_key.sh", "sandbox.enabled=true"]) {
    assert.ok(keys.includes(k), k);
  }
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0]!.event, "PreToolUse");
  assert.equal(hooks[0]!.matcher, "Bash");
  // A careful, documented configuration should only yield the informational hook note.
  assert.deepEqual(ids(findings), ["claude.hook-command"]);
});

test("claude ~/.claude.json: user servers and only this project's local servers", async () => {
  const project = "/work/acme";
  const r = await analyzeFixture("claude-global.json", "claude-global", "claude-code", "user", project, ["__PROJECT__", project]);
  assert.equal(r.status, "parsed");
  const names = r.result.mcpServers.map((s) => `${s.name}:${s.context}`);
  assert.deepEqual(names, ["stripe:user scope", "airtable:local scope"]);
  assert.ok(!JSON.stringify(r.result).includes("should-not-appear"));
  assert.deepEqual(r.result.permissions.map((p) => p.rule), ["Bash(make build)"]);
});

test("claude ~/.claude.json: Windows project keys match case-insensitively", async () => {
  const r = await analyzeFixture("claude-global.json", "claude-global", "claude-code", "user", "C:/Work/Acme", ["__PROJECT__", "c:\\\\work\\\\acme"]);
  assert.ok(r.result.mcpServers.some((s) => s.name === "airtable"));
});

test("claude .mcp.json: stdio, http, sse, ws transports", async () => {
  const r = await analyzeFixture("claude-mcp.json", "mcp-servers-json", "claude-code", "project");
  const t = Object.fromEntries(r.result.mcpServers.map((s) => [s.name, s.transport]));
  assert.deepEqual(t, { airtable: "stdio", "api-server": "http", events: "sse", socket: "ws" });
  const api = r.result.mcpServers.find((s) => s.name === "api-server")!;
  assert.deepEqual(api.headerKeys, ["Authorization"]);
  assert.equal(api.url, "${API_BASE_URL:-https://api.example.com}/mcp");
  assert.ok(!ids(r.result.findings).includes("mcp.inline-secret"));
  assert.ok(!ids(r.result.findings).includes("mcp.unpinned-package"));
});

test("cursor mcp.json: envFile noted, interpolation is not a secret", async () => {
  const r = await analyzeFixture("cursor-mcp.json", "mcp-servers-json", "cursor", "project");
  const local = r.result.mcpServers.find((s) => s.name === "local")!;
  assert.equal(local.envFile, "${workspaceFolder}/.env");
  assert.deepEqual(local.envKeys, ["API_KEY"]);
  assert.equal(r.result.mcpServers.find((s) => s.name === "remote")!.transport, "http");
  assert.deepEqual(ids(r.result.findings), ["mcp.env-file", "mcp.project-command", "mcp.remote-server"]);
});

test("cursor cli.json: token kinds map to capabilities", async () => {
  const r = await analyzeFixture("cursor-cli.json", "cursor-cli", "cursor", "project");
  const caps = Object.fromEntries(r.result.permissions.map((p) => [`${p.effect} ${p.rule}`, p.capability]));
  assert.equal(caps["allow Shell(ls)"], "shell");
  assert.equal(caps["allow Read(src/**/*.ts)"], "file-read");
  assert.equal(caps["allow Write(docs/**)"], "file-write");
  assert.equal(caps["allow WebFetch(*.github.com)"], "network");
  assert.equal(caps["allow Mcp(datadog:*)"], "mcp");
  assert.equal(caps["deny WebFetch(*)"], "network");
  // Shell(git:*) is git with any arguments; Mcp(datadog:*) is a whole server.
  assert.deepEqual(ids(r.result.findings), ["cursor.allow-mcp-wildcard", "shell.allow-destructive"]);
});

test("vscode mcp.json: servers + inputs, comments and trailing commas accepted", async () => {
  const r = await analyzeFixture("vscode-mcp.json", "vscode-mcp", "vscode", "project");
  assert.equal(r.status, "parsed");
  assert.deepEqual(r.result.warnings, []);
  assert.deepEqual(r.result.mcpServers.map((s) => s.name), ["playwright", "remote"]);
  assert.deepEqual(r.result.posture, [{ key: "inputs", value: "api-key (password)" }]);
  assert.ok(!ids(r.result.findings).includes("mcp.inline-secret"));
  assert.ok(!ids(r.result.findings).includes("mcp.unpinned-package"));
});

test("gemini settings: nested categories, trust, include/exclude tools", async () => {
  const r = await analyzeFixture("gemini-settings.json", "gemini-settings", "gemini-cli", "user");
  assert.deepEqual(r.result.warnings, []);
  const gh = r.result.mcpServers.find((s) => s.name === "github")!;
  assert.equal(gh.autoApprove, "none");
  assert.deepEqual(gh.toolsAllowed, ["get_issue"]);
  assert.deepEqual(gh.toolsDenied, ["delete_repo"]);
  assert.equal(r.result.mcpServers.find((s) => s.name === "remote")!.transport, "http");
  assert.equal(r.result.mcpServers.find((s) => s.name === "legacy-sse")!.transport, "sse");
  const rules = r.result.permissions.map((p) => `${p.effect}:${p.rule}`);
  assert.ok(rules.includes("allow:run_shell_command(git status)"));
  assert.ok(rules.includes("deny:write_file"));
  assert.ok(rules.includes("ask:web_fetch"));
  const posture = r.result.posture.map((p) => `${p.key}=${p.value}`);
  assert.ok(posture.includes("security.disableYoloMode=true"));
  assert.ok(posture.includes("mcp.allowed=github"));
  assert.ok(posture.includes("tools.sandbox=docker"));
  assert.ok(!ids(r.result.findings).includes("shell.allow-all"));
});

test("codex config.toml: policy, sandbox, profiles, MCP fields", async () => {
  const r = await analyzeFixture("codex-config.toml", "codex-toml", "codex", "user");
  assert.equal(r.status, "parsed");
  assert.deepEqual(r.result.warnings, []);
  const posture = r.result.posture.map((p) => `${p.key}=${p.value}${p.context ? ` [${p.context}]` : ""}`);
  for (const k of ["approval_policy=on-request", "sandbox_mode=workspace-write", "sandbox_workspace_write.network_access=false", "shell_environment_policy.inherit=core", "approval_policy=never [profile: ci]", "sandbox_mode=read-only [profile: ci]"]) {
    assert.ok(posture.includes(k), k);
  }
  const figma = r.result.mcpServers.find((s) => s.name === "figma")!;
  assert.equal(figma.transport, "http");
  assert.deepEqual(figma.headerKeys, ["Authorization", "X-Figma-Region", "X-Org-Id"]);
  assert.deepEqual(figma.toolsDenied, ["delete_file"]);
  assert.equal(r.result.mcpServers.find((s) => s.name === "off")!.enabled, false);
  assert.deepEqual(r.result.mcpServers.find((s) => s.name === "docs")!.envKeys, ["LOG_LEVEL"]);
  // read-only + never in a CI profile is a sane combination
  assert.ok(!ids(r.result.findings).includes("codex.approval-never"));
});

test("claude desktop and windsurf formats", async () => {
  const d = await analyzeFixture("claude-desktop.json", "mcp-servers-json", "claude-desktop", "user");
  assert.equal(d.result.mcpServers[0]!.transport, "stdio");
  assert.deepEqual(ids(d.result.findings), []);
  const w = await analyzeFixture("windsurf-mcp.json", "mcp-servers-json", "windsurf", "user");
  const remote = w.result.mcpServers.find((s) => s.name === "remote")!;
  assert.equal(remote.transport, "http");
  assert.equal(remote.url, "https://mcp.example.com/sse");
  const local = w.result.mcpServers.find((s) => s.name === "local")!;
  assert.equal(local.enabled, false);
  assert.equal(local.autoApprove, "some");
});
