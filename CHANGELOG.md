# Changelog

## 0.1.0 (unreleased)

First version.

- Discovers permission and MCP configuration for Claude Code, Codex CLI, Cursor, Gemini CLI,
  VS Code, Claude Desktop, Windsurf and Copilot CLI at user, project, local and (with `--system`)
  managed scope.
- Normalizes rules into allow/ask/deny by capability. Also reports posture settings, MCP servers
  (secret values redacted) and hooks.
- 41 risk rules, each with an explanation and a recommendation.
- Text, JSON (`schemaVersion: 1`) and self-contained static HTML output. `--fail-on` for CI.
- Read-only, offline and deterministic. Tests enforce all three.
