# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/jahau/agent-permission-map/security/advisories/new)
rather than in a public issue. Include the version, the command you ran and, if possible, a
minimal config file that reproduces the problem, with any real credentials removed.

Particularly relevant: anything that makes the tool write outside `--out`, open a network
connection, execute a command, or put a secret value into a report.

## What the tool guarantees

| Property | How it is enforced |
| --- | --- |
| No network access | `src/` imports no network module (`http`, `https`, `net`, `tls`, `dns`, `dgram`, `http2`) and does not call `fetch`. A test scans the source and both runtime dependencies for these. Another test runs a full scan with those APIs replaced by functions that abort the process. |
| No command execution | No `child_process`, `worker_threads`, `vm`, `eval` or `new Function` in `src/`, checked by the same tests. Hook commands, credential helpers and MCP server commands are reported as text only. |
| No modification of scanned files | Files are opened read-only. A test checks that `src/` calls no write API except the single `--out` writer, and another fingerprints the scanned trees (content, size, mtime, mode) before and after a scan. CI also checks that the working tree is clean after the tests. |
| `--out` does not clobber | The report file is opened with `O_EXCL`, so an existing file is never replaced unless `--force` is given. |
| Secrets stay out of reports | Values of `env`, `headers`, `http_headers` and similar maps are never copied; only key names are. Arguments after secret-named flags (`--token`, `--api-key`, ...), `KEY=value` arguments with secret-like names, token-shaped strings (GitHub, OpenAI/Anthropic style, Slack, AWS, Google, npm, GitLab, JWT, PEM keys), URL userinfo and every URL query value are replaced with `[REDACTED]`. A test checks the demo reports for the fixture secrets. |
| Minimal reading | Only known config paths are opened (listed in [docs/supported-configs.md](docs/supported-configs.md)). `envFile` targets, `.env` files, `auth.json` and credential stores are never opened. From `~/.claude.json`, only `mcpServers` and the scanned project's entry under `projects` are read; account data and other projects are ignored. Files over 25 MB, non-regular files and invalid UTF-8 are skipped. |
| Deterministic output | Reports carry no timestamps, hostnames, usernames or absolute paths for home and project files. All arrays are sorted. The golden-report tests run on Linux, macOS and Windows. |
| Safe HTML | The HTML report has no scripts and no external resources, and it sets `Content-Security-Policy: default-src 'none'`. Every value from a config file is HTML-escaped, which a test checks with hostile server names and arguments. |

## Threat model and limits

- **Config files are untrusted input.** A repository you clone controls its `.mcp.json`,
  `.claude/settings.json` and so on. Parsers check every field's type, ignore unknown keys, and
  catch internal errors per file, so one hostile file cannot stop the scan or reach other files.
  `__proto__` keys are treated as ordinary names.
- **Reports can still be sensitive.** A report lists server names, hostnames, file paths under
  your home directory, env variable *names* and the commands your agents may run. Review a report
  before you share it. Generated reports are git-ignored by default (`agent-permission-map-report.*`).
- **Redaction is heuristic.** A credential in an unusual position, for example a positional
  argument with no secret-like name or token shape, may not be recognized. Treat the inline-secret
  rule as a safety net, not a guarantee.
- **Static analysis only.** The tool describes what configuration *allows* according to vendor
  documentation. It cannot see policies delivered from a server (for example Claude Code
  server-managed settings), runtime flags such as `--dangerously-skip-permissions` or `--yolo`,
  or what an MCP server does once it runs.
- **Supply chain.** There are two runtime dependencies, `jsonc-parser` (MIT, Microsoft) and
  `smol-toml` (BSD-3-Clause). Both are pinned to exact versions, neither has dependencies of its
  own, and neither uses network or process APIs, which a test checks. CI installs with `--ignore-scripts`.
