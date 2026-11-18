# Rules

Each finding has a stable `ruleId`. Severity can depend on scope: settings in a file shared
through the repository (`project` scope) are often rated higher, because anyone who can commit
can change them. A test checks that every rule in `src/` is listed here.

## Shared shell rules

These apply to Claude Code `Bash(...)`, Cursor `Shell(...)` and Gemini `run_shell_command(...)`
allow rules. A wildcard counts as *open-ended* when it follows the program directly
(`python *`) or a subcommand that accepts arbitrary input (`npm run *`, `docker run *`,
`git push *`). `git diff *` and `npm run test *` are not open-ended.

| Rule | Severity | Trigger |
| --- | --- | --- |
| `shell.allow-all` | high | The whole shell tool is allowed (`Bash`, `Bash(*)`, `Shell(*)`, `run_shell_command`). |
| `shell.allow-code-runner` | high | An open-ended wildcard on a program that runs arbitrary code: shells, interpreters, `npx`/`uvx`, `docker`, `ssh`, `sudo`, `env`, `xargs`, … |
| `shell.allow-network-tool` | medium | An open-ended wildcard on `curl`, `wget`, `nc`, `scp`, `rsync`, `Invoke-WebRequest`, … |
| `shell.allow-script-runner` | medium | An open-ended wildcard on `npm`, `pnpm`, `yarn`, `make`, `cargo`, `go`, `gradle`, `pip`, … |
| `shell.allow-destructive` | medium | An open-ended wildcard on `rm`, `del`, `Remove-Item`, `dd`, `chmod`, `git`, … |

## MCP servers (every client)

| Rule | Severity | Trigger |
| --- | --- | --- |
| `mcp.inline-secret` | high, critical in project scope | A literal credential in `env`, `headers`, arguments, URL userinfo or query, or an OAuth client secret. |
| `mcp.auto-approved` | high | The client skips confirmation for every tool: Gemini `trust: true`, or `alwaysAllow`/`autoApprove` containing `*`. |
| `mcp.container-escape` | high | `docker`/`podman` with `--privileged`, `--network host`, `--pid host`, or a mount of `/`, a drive root, a home directory, `/etc` or the Docker socket. |
| `mcp.plaintext-remote` | high | A remote server URL with `http://` or `ws://` to a non-loopback host. |
| `mcp.unpinned-package` | medium | `npx`, `bunx`, `pnpx`, `uvx`, `pipx run`, `pnpm dlx`, `yarn dlx`, `bun x` or `uv tool run` with a package that has no exact version. |
| `mcp.shell-wrapper` | medium | The server is launched as `sh -c`, `bash -c`, `cmd /c`, `powershell -Command`, `node -e`, `python -c`, … |
| `mcp.remote-server` | info | Tool calls go to a remote host (reported once per server). |
| `mcp.env-file` | info | The server loads an env file. This tool does not open it. |
| `mcp.project-command` | info | A project-scoped stdio server: a committed file can start a local process. |

## Claude Code

| Rule | Severity | Trigger |
| --- | --- | --- |
| `claude.mode-bypass` | critical (user/managed), high (project/local) | `permissions.defaultMode: "bypassPermissions"`. |
| `claude.mode-auto` | medium (user/managed), low (project/local) | `defaultMode: "auto"`. |
| `claude.mode-accept-edits` | low | `defaultMode: "acceptEdits"`. |
| `claude.additional-directory-broad` | high | `additionalDirectories` contains `/`, `~`, a drive root or a home directory. |
| `claude.env-inline-secret` | high, critical in project scope | A literal credential in `env`. |
| `claude.enable-all-project-mcp` | high (user/managed), medium (project/local) | `enableAllProjectMcpServers: true`. |
| `claude.allow-all-writes` | medium | `Edit`/`Write`/`MultiEdit`/`NotebookEdit` allowed without a path, or with `**`. |
| `claude.allow-all-fetch` | medium | `WebFetch` or `WebFetch(domain:*)` allowed. |
| `claude.allow-reads-outside-project` | medium | `Read(~/**)`, `Read(//**)` and similar. |
| `claude.credential-helper-in-project` | medium | `apiKeyHelper`, `awsAuthRefresh`, `awsCredentialExport` or `otelHeadersHelper` in shared project settings. |
| `claude.hook-command` | medium (project), info (other scopes) | A `command` hook. |
| `claude.allow-mcp-server` | low | `mcp__<server>` or `mcp__<server>__*` allowed. |
| `claude.allow-wildcard-tool` | info | An allow rule Claude Code ignores (`*`, `mcp__*`). |

## Codex CLI

| Rule | Severity | Trigger |
| --- | --- | --- |
| `codex.sandbox-full-access` | critical with `approval_policy = "never"`, otherwise high | `sandbox_mode = "danger-full-access"` (top level or in a profile). |
| `codex.writable-root-broad` | high | `sandbox_workspace_write.writable_roots` contains `/`, `~` or a home directory. |
| `codex.approval-never` | medium | `approval_policy = "never"` without a read-only sandbox. |
| `codex.sandbox-network` | medium | `sandbox_workspace_write.network_access = true`. |

## Cursor

| Rule | Severity | Trigger |
| --- | --- | --- |
| `cursor.allow-all-writes` | medium | `Write(**)`, `Write(*)` or an absolute-path `Write` glob. |
| `cursor.allow-reads-outside-project` | medium | An absolute-path `Read` glob with `**`. |
| `cursor.allow-all-fetch` | medium | `WebFetch(*)`. |
| `cursor.allow-mcp-wildcard` | medium for `Mcp(*:…)`, low for one server | `Mcp(server:*)` or `Mcp(*:*)`. |

## Gemini CLI

| Rule | Severity | Trigger |
| --- | --- | --- |
| `gemini.mode-yolo` | critical | `general.defaultApprovalMode: "yolo"`. Documented as command-line only, so it may be ignored. |
| `gemini.allow-all-writes` | medium | `write_file`, `replace` or `edit` in `tools.allowed` without arguments. |
| `gemini.folder-trust-disabled` | medium | `security.folderTrust.enabled: false`. |
| `gemini.mode-auto-edit` | low | `defaultApprovalMode: "auto_edit"`. |
| `gemini.auto-accept` | low | `autoAccept: true`. |

## Other

| Rule | Severity | Trigger |
| --- | --- | --- |
| `source.unreadable` | info | A config file exists but could not be read or parsed. Its contents are not part of the report. |
