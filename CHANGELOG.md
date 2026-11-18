# Changelog

## 0.1.0 (2026-11-18)

First public release.

- Discovers permission and MCP configuration for Claude Code, Codex CLI, Cursor, Gemini CLI,
  VS Code, Claude Desktop, Windsurf and Copilot CLI at user, project, local and (with `--system`)
  managed scope.
- Normalizes rules into allow/ask/deny by capability. Also reports posture settings, MCP servers
  (secret values redacted) and hooks.
- 41 risk rules, each with an explanation and a recommendation.
- Text, JSON (`schemaVersion: 1`) and self-contained static HTML output. `--fail-on` for CI.
- Read-only, offline and deterministic. Tests enforce all three.

Release readiness, before tagging:

- Fixed: query-string credentials in Claude Code `allowedMcpServers[].serverUrl` and HTTP hook
  URLs were not redacted.
- Added a final pass that redacts well-known token shapes from every string in a report.
- Added `npm run lint` (strict compiler checks) to CI, and removed an unused parameter it found.
- HTML report: all summary cards fit on one row at desktop width.
- README: report preview, `npx github:` quick start, corrected claims about paths in reports and
  about VS Code profiles. Package metadata: `homepage` and `bugs`. The lockfile now records the
  Node.js 22 engine floor.
