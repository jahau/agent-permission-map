import { SEVERITIES, type Report, type Severity } from "../types.js";

const LABEL: Record<Severity, string> = { critical: "CRITICAL", high: "HIGH", medium: "MEDIUM", low: "LOW", info: "INFO" };

/** Terminal summary. No colors, so output is identical in every terminal and when piped. */
export function renderText(report: Report, opts: { maxFindings?: number } = {}): string {
  const lines: string[] = [];
  const s = report.summary;
  const max = opts.maxFindings ?? 50;
  lines.push(`agent-permission-map ${report.generator.version}`);
  lines.push("");
  if (s.sources === 0) {
    lines.push(`No agent configuration files found (${report.scan.locationsChecked} locations checked).`);
    return lines.join("\n") + "\n";
  }
  lines.push(`Scanned ${s.sources} file${s.sources === 1 ? "" : "s"} for ${s.agents.join(", ")} (${report.scan.locationsChecked} locations checked).`);
  lines.push(`${s.permissionRules} permission rules, ${s.mcpServers} MCP servers, ${s.hooks} hooks.`);
  lines.push("Findings: " + SEVERITIES.map((sev) => `${s.findings[sev]} ${sev}`).join(", "));
  lines.push("");
  lines.push("Sources");
  for (const src of report.sources) {
    const status = src.status === "error" ? `  ERROR: ${src.error}` : src.warnings.length ? `  (${src.warnings.length} warning${src.warnings.length === 1 ? "" : "s"})` : "";
    lines.push(`  ${src.id}  ${src.agent.padEnd(14)} ${src.scope.padEnd(8)} ${src.path}${status}`);
  }
  if (report.findings.length > 0) {
    lines.push("");
    lines.push("Findings");
    const shown = report.findings.slice(0, max);
    for (const f of shown) {
      const src = report.sources.find((x) => x.id === f.source);
      lines.push(`  [${LABEL[f.severity]}] ${f.title}`);
      lines.push(`      ${f.subject}  —  ${src?.path ?? f.source}`);
      lines.push(`      Why: ${f.explanation}`);
      lines.push(`      Fix: ${f.recommendation}`);
    }
    if (report.findings.length > shown.length) {
      lines.push(`  … ${report.findings.length - shown.length} more. Use --format json or --format html for the full report.`);
    }
  }
  return lines.join("\n") + "\n";
}
