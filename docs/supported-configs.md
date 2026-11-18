# Supported configuration files

Verified against vendor documentation on **2026-11-18**. Formats change. When one does, update
the parser, the schema fixture in `test/fixtures/schemas/` and this page together.

`~` is the home directory. `<appdata>` is each of `~/AppData/Roaming` (Windows),
`~/Library/Application Support` (macOS) and `~/.config` (Linux). All three are checked under
the scanned home on every OS, so a given home directory produces the same report everywhere.
Without `--home`, `APPDATA` and `XDG_CONFIG_HOME` are checked too.

## Claude Code

Docs: <https://code.claude.com/docs/en/settings>, <https://code.claude.com/docs/en/permissions>,
<https://code.claude.com/docs/en/mcp>

| Path | Scope | Format |
| --- | --- | --- |
| `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`) | user | settings |
| `.claude/settings.json` | project (shared via git) | settings |
| `.claude/settings.local.json` | local (personal, git-ignored) | settings |
| `.mcp.json` | project | `{ "mcpServers": {...} }` |
| `~/.claude.json` | user / local | global config; only `mcpServers` and `projects[<scanned project>].mcpServers` / `allowedTools` / `enabled…/disabledMcpjsonServers` are read |
| `managed-settings.json`, `managed-mcp.json` in `/etc/claude-code`, `/Library/Application Support/ClaudeCode`, `C:\Program Files\ClaudeCode` | managed (`--system`) | settings / mcpServers |

Settings keys read: `permissions.allow|ask|deny` (rule syntax `Tool` or `Tool(spec)`, e.g.
`Bash(npm run *)`, `Read(./.env)`, `WebFetch(domain:example.com)`, `mcp__server__tool`),
`permissions.defaultMode` (`default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`),
`permissions.additionalDirectories`, `permissions.disableBypassPermissionsMode`, `disableAutoMode`,
`denyInsteadOfPrompting`, `blockReadsOutsideWorkingDirectories`, `blockWritesOutsideWorkingDirectories`,
`allowManagedPermissionRulesOnly`, `enableAllProjectMcpServers`, `enabledMcpjsonServers`,
`disabledMcpjsonServers`, `allowedMcpServers`, `deniedMcpServers`, `hooks`, `disableAllHooks`,
`env` (names only), `apiKeyHelper`, `awsAuthRefresh`, `awsCredentialExport`, `otelHeadersHelper`,
`sandbox.enabled|autoAllowBashIfSandboxed|allowUnsandboxedCommands|network.allowedDomains`.

Facts the rules rely on:
- Rules are evaluated deny → ask → allow. `Bash(*)` is the same as `Bash`.
- Allow rules with a bare glob tool name (`*`, `mcp__*`) are skipped by Claude Code. MCP allow globs must follow a literal `mcp__<server>__` prefix. `mcp__` rules with parentheses are skipped.
- `defaultMode` values `auto` and `bypassPermissions` do not take effect from project or local settings from v2.1.257 on.
- MCP `type` may be omitted (stdio), or set to `http` (alias `streamable-http`), `sse`, `ws`. `sdk` entries are skipped in files. An entry with `url` but no `type` is a configuration error.
- `.mcp.json` supports `${VAR}` and `${VAR:-default}` expansion.

## Codex CLI

Docs: <https://developers.openai.com/codex/config-reference> (redirects to learn.chatgpt.com)

| Path | Scope |
| --- | --- |
| `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`) | user |
| `.codex/config.toml` | project (loaded only for trusted projects) |

Keys read: `approval_policy` (`on-request`, `never`, a `granular` table; `on-failure`
deprecated), `sandbox_mode` (`read-only`, `workspace-write`, `danger-full-access`),
`sandbox_workspace_write.network_access|writable_roots`, `shell_environment_policy.inherit`,
`profile`, `[profiles.<name>]` (the same keys per profile), and
`[mcp_servers.<name>]`: `command`, `args`, `env` (names), `env_vars`, `cwd`, `url`,
`bearer_token_env_var`, `http_headers` (names), `env_http_headers` (names), `enabled`,
`enabled_tools`, `disabled_tools`. Keys that project files ignore (`profile`, `profiles`,
`model_provider(s)`, `notify`, `otel`) produce a warning there. `[projects.*]` trust entries are
not read, because they list other local paths.

## Cursor

Docs: <https://cursor.com/docs/context/mcp>, <https://cursor.com/docs/cli/reference/permissions>

| Path | Scope | Format |
| --- | --- | --- |
| `~/.cursor/mcp.json`, `.cursor/mcp.json` | user / project | `mcpServers` with `type`, `command`, `args`, `env`, `envFile`, `url`, `headers`, `auth` |
| `~/.cursor/cli-config.json`, `.cursor/cli.json` | user / project | `permissions.allow|deny` with `Shell(cmd)`, `Read(glob)`, `Write(glob)`, `WebFetch(domain)`, `Mcp(server:tool)`; only `permissions` is read |

`Shell(cmd)` matches the first word of a command, so `Shell(git)` covers every `git` command.
Interpolation: `${env:NAME}`, `${userHome}`, `${workspaceFolder}`.

## Gemini CLI

Docs: <https://geminicli.com/docs/reference/configuration/>

| Path | Scope |
| --- | --- |
| `~/.gemini/settings.json` | user |
| `.gemini/settings.json` | project |
| `/etc/gemini-cli/`, `/Library/Application Support/GeminiCli/`, `C:\ProgramData\gemini-cli\` `settings.json` and `system-defaults.json` | system (`--system`) |

Nested (v0.3+) keys read: `tools.allowed`, `tools.exclude`, `tools.core`,
`tools.confirmationRequired`, `tools.sandbox`, `tools.sandboxNetworkAccess`, `tools.autoAccept`,
`general.defaultApprovalMode` (`default`, `auto_edit`, `plan`; YOLO is documented as
command-line only), `security.disableYoloMode|disableAlwaysAllow|toolSandboxing|blockGitExtensions|folderTrust.enabled`,
`mcp.allowed|excluded`, and `mcpServers.<name>`: `command`, `args`, `env` (names), `cwd`,
`url` (SSE), `httpUrl` (streamable HTTP), `headers` (names), `trust`, `includeTools`,
`excludeTools`. Legacy flat keys (`coreTools`, `excludeTools`, `allowedTools`, `autoAccept`,
`allowMCPServers`, `excludeMCPServers`) are read with a warning.

## VS Code (GitHub Copilot)

Docs: <https://code.visualstudio.com/docs/agents/reference/mcp-configuration>

| Path | Scope | Format |
| --- | --- | --- |
| `.vscode/mcp.json` | project | `{ "servers": {...}, "inputs": [...] }`, comments allowed |
| `<appdata>/Code/User/mcp.json`, `<appdata>/Code - Insiders/User/mcp.json` | user (default profile) | same |

Server fields: `type` (`stdio`, `http`, `sse`), `command`, `args`, `cwd`, `env`, `envFile`,
`url`, `headers`, `oauth`. `inputs` ids are listed, with `password: true` noted. VS Code
documents this `servers` format as deprecated for its local harness from February 2027, in
favor of the portable `mcpServers` format in `.mcp.json` / `~/.copilot/mcp-config.json`. Both
are read. VS Code `settings.json` auto-approve settings are not read yet.

## Claude Desktop, Windsurf, Copilot CLI

| Agent | Path | Notes |
| --- | --- | --- |
| Claude Desktop | `<appdata>/Claude/claude_desktop_config.json` | `mcpServers` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `mcpServers`, with `serverUrl` for remote servers. Best effort: Windsurf's MCP docs now redirect to Devin Desktop, whose `.devin/mcp_config.json` format was not documented in enough detail to support. |
| Copilot CLI | `~/.copilot/mcp-config.json` (or `$COPILOT_HOME/mcp-config.json`) | `mcpServers` |

Cline / Roo-style `alwaysAllow` / `autoApprove` lists and `disabled: true` are understood in any
`mcpServers` file.
