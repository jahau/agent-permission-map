import { SEVERITIES, type Agent, type Capability, type Report } from "../types.js";

const AGENT_NAME: Record<Agent, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  codex: "Codex CLI",
  copilot: "Copilot CLI",
  cursor: "Cursor",
  "gemini-cli": "Gemini CLI",
  vscode: "VS Code",
  windsurf: "Windsurf",
};

const CAPS: { cap: Capability; label: string }[] = [
  { cap: "shell", label: "Shell" },
  { cap: "file-read", label: "Read files" },
  { cap: "file-write", label: "Write files" },
  { cap: "network", label: "Network" },
  { cap: "mcp", label: "MCP tools" },
  { cap: "directory", label: "Extra dirs" },
  { cap: "tool", label: "Other tools" },
];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Escape, then render `code` spans. */
function rich(s: string): string {
  return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
}

const CSS = `
:root{--bg:#f7f7f5;--panel:#fff;--text:#1d1d1b;--muted:#5f5f5a;--border:#e2e1dc;--code:#f0efea;
--critical:#b3261e;--critical-bg:#fbe9e7;--high:#c2410c;--high-bg:#fdeee4;--medium:#a16207;--medium-bg:#fbf3d9;
--low:#1d4ed8;--low-bg:#e7eefc;--info:#52525b;--info-bg:#eeeeec;--ok:#15803d;--ok-bg:#e6f4ea}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161615;--panel:#1f1f1d;--text:#ecebe6;--muted:#a3a29b;--border:#34332f;--code:#2a2a27;
--critical:#ff8a80;--critical-bg:#3d1714;--high:#fdba74;--high-bg:#3a2112;--medium:#fcd34d;--medium-bg:#352b0e;--low:#93b4fd;--low-bg:#172440;--info:#c4c4bf;--info-bg:#2a2a27;--ok:#86efac;--ok-bg:#12301d}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1120px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:26px;margin:0 0 4px;letter-spacing:-.01em}
h2{font-size:18px;margin:40px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--border)}
p.lede{color:var(--muted);margin:0 0 24px}
code{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code);padding:1px 5px;border-radius:4px;word-break:break-word}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:10px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.card b{display:block;font-size:24px;line-height:1.2}
.card span{color:var(--muted);font-size:13px}
.sev{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;border-radius:999px;white-space:nowrap}
.sev.critical{color:var(--critical);background:var(--critical-bg)}.sev.high{color:var(--high);background:var(--high-bg)}
.sev.medium{color:var(--medium);background:var(--medium-bg)}.sev.low{color:var(--low);background:var(--low-bg)}.sev.info{color:var(--info);background:var(--info-bg)}
.card.critical b{color:var(--critical)}.card.high b{color:var(--high)}.card.medium b{color:var(--medium)}.card.low b{color:var(--low)}
details.finding{background:var(--panel);border:1px solid var(--border);border-left:4px solid var(--info);border-radius:8px;margin:8px 0}
details.finding.critical{border-left-color:var(--critical)}details.finding.high{border-left-color:var(--high)}details.finding.medium{border-left-color:var(--medium)}details.finding.low{border-left-color:var(--low)}
details.finding summary{cursor:pointer;padding:10px 14px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;list-style:none}
details.finding summary::-webkit-details-marker{display:none}
details.finding summary .t{font-weight:600;flex:1 1 300px}
details.finding summary .where{color:var(--muted);font-size:13px}
details.finding .body{padding:0 14px 12px 14px}
details.finding .body p{margin:6px 0}
.label{color:var(--muted);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-right:6px}
.tablewrap{overflow-x:auto;background:var(--panel);border:1px solid var(--border);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--border);vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600;background:var(--panel);position:sticky;top:0}
tr:last-child td{border-bottom:0}
td.cell{white-space:nowrap}
.pill{display:inline-block;font-size:12px;padding:1px 7px;border-radius:999px;margin:1px 2px 1px 0}
.pill.allow{background:var(--high-bg);color:var(--high)}.pill.ask{background:var(--medium-bg);color:var(--medium)}.pill.deny{background:var(--ok-bg);color:var(--ok)}
.pill.broad{background:var(--critical-bg);color:var(--critical);font-weight:700}
.muted{color:var(--muted)}
.empty{color:var(--muted);font-style:italic;padding:12px 0}
ul.warn{margin:4px 0 0;padding-left:18px;color:var(--muted);font-size:13px}
footer{margin-top:48px;color:var(--muted);font-size:13px}
`;

/**
 * Self-contained static HTML report: no scripts, no external resources, and a
 * Content-Security-Policy that forbids loading anything. All text is escaped.
 */
export function renderHtml(report: Report): string {
  const s = report.summary;
  const srcPath = new Map(report.sources.map((x) => [x.id, x.path]));
  const out: string[] = [];
  const title = report.scan.projectName ? `Agent permission map: ${report.scan.projectName}` : "Agent permission map";

  out.push("<!doctype html>");
  out.push('<html lang="en"><head><meta charset="utf-8">');
  out.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  out.push(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`);
  out.push('<meta name="referrer" content="no-referrer">');
  out.push(`<title>${esc(title)}</title><style>${CSS}</style></head><body><main>`);
  out.push(`<h1>${esc(title)}</h1>`);
  out.push(
    `<p class="lede">What your AI coding agents may do without asking, gathered from ${s.sources} configuration file${s.sources === 1 ? "" : "s"} (${report.scan.locationsChecked} locations checked). Generated offline by agent-permission-map ${esc(report.generator.version)}; no commands were run and no servers were contacted. Secret values are never included.</p>`,
  );

  // Summary cards
  out.push('<div class="cards">');
  for (const sev of SEVERITIES) {
    out.push(`<div class="card ${sev}"><b>${s.findings[sev]}</b><span>${sev} finding${s.findings[sev] === 1 ? "" : "s"}</span></div>`);
  }
  out.push(`<div class="card"><b>${s.permissionRules}</b><span>permission rules</span></div>`);
  out.push(`<div class="card"><b>${s.mcpServers}</b><span>MCP servers</span></div>`);
  out.push(`<div class="card"><b>${s.hooks}</b><span>hooks</span></div>`);
  out.push("</div>");

  // Permission map
  out.push("<h2>Permission map</h2>");
  if (report.sources.length === 0) {
    out.push('<p class="empty">No agent configuration files were found.</p>');
  } else {
    out.push('<p class="muted">Rules by agent and capability. <span class="pill broad">broad</span> marks rules that cover a whole capability rather than a narrow target. Where an agent supports both, deny rules take precedence over allow rules.</p>');
    out.push('<div class="tablewrap"><table><thead><tr><th>Agent</th>');
    for (const c of CAPS) out.push(`<th>${c.label}</th>`);
    out.push("<th>MCP servers</th></tr></thead><tbody>");
    for (const agent of s.agents) {
      out.push(`<tr><td><b>${esc(AGENT_NAME[agent])}</b></td>`);
      for (const c of CAPS) {
        const rules = report.permissions.filter((p) => p.agent === agent && p.capability === c.cap);
        if (rules.length === 0) {
          out.push('<td class="cell muted">–</td>');
          continue;
        }
        const parts: string[] = [];
        for (const eff of ["allow", "ask", "deny"] as const) {
          const n = rules.filter((r) => r.effect === eff).length;
          if (n > 0) parts.push(`<span class="pill ${eff}">${n} ${eff}</span>`);
        }
        if (rules.some((r) => r.broad && r.effect === "allow")) parts.push('<span class="pill broad">broad</span>');
        out.push(`<td class="cell">${parts.join("")}</td>`);
      }
      const servers = report.mcpServers.filter((m) => m.agent === agent);
      out.push(`<td class="cell">${servers.length || '<span class="muted">–</span>'}</td></tr>`);
    }
    out.push("</tbody></table></div>");
  }

  // Findings
  out.push("<h2>Findings</h2>");
  if (report.findings.length === 0) out.push('<p class="empty">No risky settings found.</p>');
  for (const f of report.findings) {
    const open = f.severity === "critical" || f.severity === "high" ? " open" : "";
    out.push(`<details class="finding ${f.severity}"${open}><summary><span class="sev ${f.severity}">${f.severity}</span><span class="t">${rich(f.title)}</span><span class="where">${esc(AGENT_NAME[f.agent])} · <code>${esc(srcPath.get(f.source) ?? f.source)}</code></span></summary>`);
    out.push('<div class="body">');
    out.push(`<p><span class="label">Subject</span><code>${esc(f.subject)}</code></p>`);
    out.push(`<p><span class="label">Why it matters</span>${rich(f.explanation)}</p>`);
    out.push(`<p><span class="label">What to do</span>${rich(f.recommendation)}</p>`);
    out.push(`<p class="muted"><span class="label">Rule</span>${esc(f.ruleId)}</p>`);
    out.push("</div></details>");
  }

  // MCP servers
  out.push("<h2>MCP servers</h2>");
  if (report.mcpServers.length === 0) out.push('<p class="empty">No MCP servers configured.</p>');
  else {
    out.push('<div class="tablewrap"><table><thead><tr><th>Server</th><th>Agent</th><th>Transport</th><th>Launches / connects to</th><th>Env &amp; headers (names only)</th><th>Auto-approve</th><th>Source</th></tr></thead><tbody>');
    for (const m of report.mcpServers) {
      const target = m.transport === "stdio" ? [m.command ?? "", ...m.args].join(" ") : m.url ?? "";
      const keys = [...m.envKeys.map((k) => `env:${k}`), ...m.headerKeys.map((k) => `header:${k}`)];
      out.push(
        `<tr><td><b>${esc(m.name)}</b>${m.enabled ? "" : ' <span class="muted">(disabled)</span>'}${m.context ? `<br><span class="muted">${esc(m.context)}</span>` : ""}</td><td>${esc(AGENT_NAME[m.agent])}</td><td>${esc(m.transport)}</td><td><code>${esc(target)}</code></td><td>${keys.length ? keys.map((k) => `<code>${esc(k)}</code>`).join(" ") : '<span class="muted">–</span>'}</td><td>${esc(m.autoApprove)}</td><td><code>${esc(srcPath.get(m.source) ?? m.source)}</code></td></tr>`,
      );
    }
    out.push("</tbody></table></div>");
  }

  // Rules
  out.push("<h2>All permission rules</h2>");
  if (report.permissions.length === 0) out.push('<p class="empty">No permission rules configured.</p>');
  else {
    out.push('<div class="tablewrap"><table><thead><tr><th>Effect</th><th>Rule</th><th>Capability</th><th>Agent</th><th>Source</th></tr></thead><tbody>');
    for (const p of report.permissions) {
      out.push(
        `<tr><td><span class="pill ${p.effect}">${p.effect}</span>${p.broad && p.effect === "allow" ? '<span class="pill broad">broad</span>' : ""}</td><td><code>${esc(p.rule)}</code>${p.context ? ` <span class="muted">${esc(p.context)}</span>` : ""}</td><td>${esc(p.capability)}</td><td>${esc(AGENT_NAME[p.agent])}</td><td><code>${esc(srcPath.get(p.source) ?? p.source)}</code></td></tr>`,
      );
    }
    out.push("</tbody></table></div>");
  }

  // Hooks
  if (report.hooks.length > 0) {
    out.push("<h2>Hooks</h2>");
    out.push('<div class="tablewrap"><table><thead><tr><th>Event</th><th>Matcher</th><th>Command</th><th>Source</th></tr></thead><tbody>');
    for (const h of report.hooks) {
      out.push(`<tr><td>${esc(h.event)}</td><td>${h.matcher ? `<code>${esc(h.matcher)}</code>` : '<span class="muted">–</span>'}</td><td><code>${esc(h.command)}</code></td><td><code>${esc(srcPath.get(h.source) ?? h.source)}</code></td></tr>`);
    }
    out.push("</tbody></table></div>");
  }

  // Posture
  if (report.posture.length > 0) {
    out.push("<h2>Modes, sandbox and approval settings</h2>");
    out.push('<div class="tablewrap"><table><thead><tr><th>Setting</th><th>Value</th><th>Agent</th><th>Source</th></tr></thead><tbody>');
    for (const p of report.posture) {
      out.push(`<tr><td><code>${esc(p.key)}</code>${p.context ? ` <span class="muted">${esc(p.context)}</span>` : ""}</td><td><code>${esc(String(p.value))}</code></td><td>${esc(AGENT_NAME[p.agent])}</td><td><code>${esc(srcPath.get(p.source) ?? p.source)}</code></td></tr>`);
    }
    out.push("</tbody></table></div>");
  }

  // Sources
  out.push("<h2>Configuration files</h2>");
  if (report.sources.length === 0) out.push('<p class="empty">None found.</p>');
  else {
    out.push('<div class="tablewrap"><table><thead><tr><th>ID</th><th>File</th><th>Agent</th><th>Scope</th><th>Status</th></tr></thead><tbody>');
    for (const src of report.sources) {
      const status = src.status === "error" ? `<span class="sev high">error</span> ${esc(src.error ?? "")}` : '<span class="sev info">parsed</span>';
      const warn = src.warnings.length ? `<ul class="warn">${src.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : "";
      out.push(`<tr><td>${src.id}</td><td><code>${esc(src.path)}</code>${warn}</td><td>${esc(AGENT_NAME[src.agent])}</td><td>${esc(src.scope)}</td><td>${status}</td></tr>`);
    }
    out.push("</tbody></table></div>");
  }

  out.push('<footer>Static report. Explanations describe what each setting allows according to the agent\'s documentation; they are not proof of compromise. Review findings in context.</footer>');
  out.push("</main></body></html>");
  return out.join("\n") + "\n";
}
