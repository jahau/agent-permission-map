import * as path from "node:path";

/** Normalize a filesystem path for comparison: forward slashes, no trailing slash, resolved dots. */
export function normalizeFsPath(p: string): string {
  let s = p.replace(/\\/g, "/");
  // Use posix normalization so the result is identical on every OS.
  const drive = /^[A-Za-z]:/.exec(s)?.[0];
  if (drive) s = s.slice(2);
  s = path.posix.normalize(s || "/");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return drive ? drive.toUpperCase() + s : s;
}

/** Compare paths, case-insensitively when they look like Windows paths. */
export function samePath(a: string, b: string): boolean {
  if (/^[A-Za-z]:/.test(a) || /^[A-Za-z]:/.test(b)) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

export interface Roots {
  home: string | null;
  project: string | null;
}

/**
 * Turn an absolute path into the path shown in reports. Paths under the
 * project become "./...", under home "~/...", anything else stays absolute.
 * The project wins when it is inside home.
 */
export function displayPath(abs: string, roots: Roots): string {
  const n = normalizeFsPath(abs);
  const rel = (root: string | null): string | null => {
    if (!root) return null;
    const r = normalizeFsPath(root);
    if (samePath(n, r)) return "";
    const prefix = r.endsWith("/") ? r : r + "/";
    if (n.length > prefix.length && samePath(n.slice(0, prefix.length), prefix)) return n.slice(prefix.length);
    return null;
  };
  const p = rel(roots.project);
  if (p !== null) return p === "" ? "." : `./${p}`;
  const h = rel(roots.home);
  if (h !== null) return h === "" ? "~" : `~/${h}`;
  return n;
}
