import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { DEMO, REPO, runCli, tempDir, treeFingerprint, writeFiles } from "./helpers.js";

async function listFiles(dir: string, exts: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p, exts)));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out.sort();
}

const FORBIDDEN_MODULES = ["http", "https", "http2", "net", "tls", "dgram", "dns", "child_process", "cluster", "worker_threads", "inspector", "vm", "repl"];
const moduleRe = new RegExp(`(?:from\\s*|import\\s*\\(\\s*|require\\s*\\(\\s*)["'](?:node:)?(${FORBIDDEN_MODULES.join("|")})(?:/[^"']*)?["']`);

test("source never imports network, process or eval modules", async () => {
  for (const file of await listFiles(path.join(REPO, "src"), [".ts"])) {
    const text = await fs.readFile(file, "utf8");
    assert.doesNotMatch(text, moduleRe, path.relative(REPO, file));
    assert.doesNotMatch(text, /\bfetch\s*\(|\bnew Function\s*\(|\beval\s*\(|process\.binding|\brequire\s*\(/, path.relative(REPO, file));
  }
});

test("only the CLI's --out handler writes files", async () => {
  const names = "writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|mkdtemp|rm|rmSync|rmdir|unlink|unlinkSync|rename|renameSync|copyFile|cp|chmod|chown|symlink|link|truncate|ftruncate|utimes|createWriteStream|writeSync|write";
  const writeApi = new RegExp(`\\.(${names})\\s*\\(`);
  const importedWrite = new RegExp(`import\\s*\\{[^}]*\\b(${names})\\b[^}]*\\}\\s*from\\s*["'](node:)?fs`);
  for (const file of await listFiles(path.join(REPO, "src"), [".ts"])) {
    const text = await fs.readFile(file, "utf8");
    const rel = path.relative(REPO, file).replace(/\\/g, "/");
    assert.doesNotMatch(text, importedWrite, rel);
    const hits = text.split("\n").filter((l) => writeApi.test(l.replace(/process\.(stdout|stderr)\.write\(/g, "")));
    if (rel === "src/cli.ts") assert.deepEqual(hits.map((l) => l.trim()), ['await fh.writeFile(data, "utf8");'], rel);
    else assert.deepEqual(hits, [], rel);
  }
});

test("runtime dependencies do not use network or process modules", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(REPO, "package.json"), "utf8")) as { dependencies: Record<string, string> };
  for (const dep of Object.keys(pkg.dependencies)) {
    const files = await listFiles(path.join(REPO, "node_modules", dep), [".js", ".mjs", ".cjs"]);
    assert.ok(files.length > 0, dep);
    for (const f of files) {
      const text = await fs.readFile(f, "utf8");
      assert.doesNotMatch(text, moduleRe, path.relative(REPO, f));
      assert.doesNotMatch(text, /\bfetch\s*\(|XMLHttpRequest/, path.relative(REPO, f));
    }
  }
});

test("a full scan runs with network and subprocess APIs disabled", async () => {
  const preload = path.join(REPO, "test", "fixtures", "block-io.mjs");
  const bin = path.join(REPO, "build-test", "src", "bin.js");
  const res = spawnSync(process.execPath, ["--import", pathToImportUrl(preload), bin, "demo", "--format", "json"], { encoding: "utf8", cwd: REPO });
  assert.equal(res.stderr.includes("BLOCKED"), false, res.stderr);
  assert.equal(res.status, 0, res.stderr);
  const report = JSON.parse(res.stdout) as { summary: { sources: number } };
  assert.ok(report.summary.sources > 0);
  // Prove the guard works: the same preload blocks a deliberate connection.
  const probe = spawnSync(process.execPath, ["--import", pathToImportUrl(preload), "-e", "require('node:net').connect(9, '127.0.0.1')"], { encoding: "utf8" });
  assert.match(probe.stderr, /BLOCKED net/);
});

function pathToImportUrl(p: string): string {
  return pathToFileURL(p).href;
}

test("scanning does not modify the scanned trees", async () => {
  const before = await treeFingerprint(DEMO);
  for (const format of ["json", "html", "text"]) {
    const r = await runCli(["demo", "--format", format]);
    assert.equal(r.code, 0);
  }
  assert.equal(await treeFingerprint(DEMO), before);

  const dir = await tempDir();
  try {
    await writeFiles(dir, {
      "home/.claude/settings.json": '{"permissions":{"allow":["Bash"]}}',
      "proj/.mcp.json": '{"mcpServers":{"a":{"command":"npx","args":["x"]}}}',
      "proj/.codex/config.toml": 'sandbox_mode = "danger-full-access"\n',
    });
    const fp = await treeFingerprint(dir);
    const r = await runCli(["--home", path.join(dir, "home"), "--project", path.join(dir, "proj"), "--format", "json"]);
    assert.equal(r.code, 0);
    assert.equal(await treeFingerprint(dir), fp);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("reports never contain fixture secrets or unrelated private data", async () => {
  const leaks = ["demo-password", "demo-not-a-real-token-value", "demo-inline-api-key-value", "demo-user@example.com", "oauthAccount", "some-other-project", "other-project-server", "numStartups"];
  for (const format of ["json", "html", "text"]) {
    const r = await runCli(["demo", "--format", format]);
    for (const s of leaks) assert.equal(r.stdout.includes(s), false, `${format} leaks ${s}`);
  }
});
