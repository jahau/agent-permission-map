import * as path from "node:path";
import type { Agent, FileFormat, Scope } from "./types.js";

export interface Candidate {
  agent: Agent;
  scope: Scope;
  format: FileFormat;
  /** Absolute path. */
  path: string;
}

export interface DiscoverOptions {
  /** Home directory. Null skips user-level files. */
  home: string | null;
  /** Project root. Null skips project-level files. */
  project: string | null;
  includeSystem: boolean;
  /**
   * Environment overrides (CLAUDE_CONFIG_DIR, CODEX_HOME, APPDATA, XDG_CONFIG_HOME, ...).
   * Pass {} for a fully deterministic scan that depends only on `home` and `project`.
   */
  env: Record<string, string | undefined>;
  /** Defaults to process.platform; only affects system (managed) locations. */
  platform?: NodeJS.Platform;
}

const join = (...p: string[]): string => path.join(...p);

/**
 * Every location this tool knows about. Application-data paths are listed for
 * all three operating systems under `home`, so the same home directory yields
 * the same candidate list on any OS. Nothing here touches the filesystem.
 */
export function candidates(opts: DiscoverOptions): Candidate[] {
  const out: Candidate[] = [];
  const add = (agent: Agent, scope: Scope, format: FileFormat, p: string): void => {
    out.push({ agent, scope, format, path: path.resolve(p) });
  };
  const { home, project, env } = opts;

  if (project) {
    add("claude-code", "project", "claude-settings", join(project, ".claude", "settings.json"));
    add("claude-code", "local", "claude-settings", join(project, ".claude", "settings.local.json"));
    add("claude-code", "project", "mcp-servers-json", join(project, ".mcp.json"));
    add("cursor", "project", "mcp-servers-json", join(project, ".cursor", "mcp.json"));
    add("cursor", "project", "cursor-cli", join(project, ".cursor", "cli.json"));
    add("vscode", "project", "vscode-mcp", join(project, ".vscode", "mcp.json"));
    add("gemini-cli", "project", "gemini-settings", join(project, ".gemini", "settings.json"));
    add("codex", "project", "codex-toml", join(project, ".codex", "config.toml"));
  }

  if (home) {
    const claudeDir = env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
    add("claude-code", "user", "claude-settings", join(claudeDir, "settings.json"));
    add("claude-code", "user", "claude-global", env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, ".claude.json") : join(home, ".claude.json"));

    const codexHome = env.CODEX_HOME ?? join(home, ".codex");
    add("codex", "user", "codex-toml", join(codexHome, "config.toml"));

    add("gemini-cli", "user", "gemini-settings", join(home, ".gemini", "settings.json"));
    add("cursor", "user", "mcp-servers-json", join(home, ".cursor", "mcp.json"));
    add("cursor", "user", "cursor-cli", join(home, ".cursor", "cli-config.json"));
    add("windsurf", "user", "mcp-servers-json", join(home, ".codeium", "windsurf", "mcp_config.json"));
    add("copilot", "user", "mcp-servers-json", join(env.COPILOT_HOME ?? join(home, ".copilot"), "mcp-config.json"));

    // Per-OS application data directories.
    const appDirs = new Set<string>([
      join(home, "AppData", "Roaming"), // Windows
      join(home, "Library", "Application Support"), // macOS
      join(home, ".config"), // Linux
    ]);
    if (env.APPDATA) appDirs.add(env.APPDATA);
    if (env.XDG_CONFIG_HOME) appDirs.add(env.XDG_CONFIG_HOME);
    for (const dir of appDirs) {
      add("claude-desktop", "user", "mcp-servers-json", join(dir, "Claude", "claude_desktop_config.json"));
      add("vscode", "user", "vscode-mcp", join(dir, "Code", "User", "mcp.json"));
      add("vscode", "user", "vscode-mcp", join(dir, "Code - Insiders", "User", "mcp.json"));
    }
  }

  if (opts.includeSystem) {
    // System locations are inherently per-OS; only the current platform's are checked.
    const platform = opts.platform ?? process.platform;
    let claudeManaged: string;
    let geminiSystem: string;
    if (platform === "win32") {
      claudeManaged = join(env.ProgramFiles ?? env.PROGRAMFILES ?? "C:\\Program Files", "ClaudeCode");
      geminiSystem = join(env.ProgramData ?? env.PROGRAMDATA ?? "C:\\ProgramData", "gemini-cli");
    } else if (platform === "darwin") {
      claudeManaged = "/Library/Application Support/ClaudeCode";
      geminiSystem = "/Library/Application Support/GeminiCli";
    } else {
      claudeManaged = "/etc/claude-code";
      geminiSystem = "/etc/gemini-cli";
    }
    add("claude-code", "managed", "claude-settings", join(claudeManaged, "managed-settings.json"));
    add("claude-code", "managed", "mcp-servers-json", join(claudeManaged, "managed-mcp.json"));
    add("gemini-cli", "system", "gemini-settings", join(geminiSystem, "system-defaults.json"));
    add("gemini-cli", "system", "gemini-settings", join(geminiSystem, "settings.json"));
  }

  // De-duplicate (e.g. APPDATA equal to the default) while keeping a stable order.
  const seen = new Set<string>();
  return out.filter((c) => {
    const key = `${c.agent}|${c.format}|${c.path.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
