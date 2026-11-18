// Offline dependency license check. Reads package-lock.json and each installed
// package's package.json; fails if a license is outside the allowlist.
// Runtime dependencies must be compatible with distribution under Apache-2.0.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "Unlicense"]);

const lock = JSON.parse(readFileSync(path.join(repo, "package-lock.json"), "utf8"));
const rows = [];
let failed = false;
for (const [key, meta] of Object.entries(lock.packages ?? {})) {
  if (key === "") continue;
  const pkgJson = path.join(repo, key, "package.json");
  // Optional platform-specific packages may be absent on this OS.
  if (!existsSync(pkgJson)) continue;
  const pkg = JSON.parse(readFileSync(pkgJson, "utf8"));
  const license = typeof pkg.license === "string" ? pkg.license : pkg.license?.type ?? "UNKNOWN";
  const kind = meta.dev ? "dev" : "runtime";
  const ok = license.split(/\s+OR\s+|\s+AND\s+|[()]/).filter(Boolean).every((l) => ALLOWED.has(l.trim()));
  if (!ok) failed = true;
  rows.push(`${ok ? "ok  " : "FAIL"}  ${kind.padEnd(7)}  ${pkg.name}@${pkg.version}  ${license}`);
}
rows.sort((a, b) => (a.slice(6) < b.slice(6) ? -1 : 1));
console.log(rows.join("\n"));
if (failed) {
  console.error("\nOne or more dependency licenses are not on the allowlist. See docs/license-review.md.");
  process.exit(1);
}
