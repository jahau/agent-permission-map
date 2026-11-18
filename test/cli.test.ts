import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { renderHtml } from "../src/render/html.js";
import { scan } from "../src/scan.js";
import { VERSION } from "../src/version.js";
import { REPO, runCli, tempDir, writeFiles } from "./helpers.js";

test("version matches package.json", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(REPO, "package.json"), "utf8")) as { version: string };
  assert.equal(VERSION, pkg.version);
  assert.equal((await runCli(["--version"])).stdout, `${pkg.version}\n`);
});

test("help exits 0", async () => {
  const r = await runCli(["--help"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Usage/);
});

test("usage errors exit 2", async () => {
  for (const args of [["--format", "xml"], ["--fail-on", "severe"], ["bogus"], ["--nope"], ["scan", "extra"], ["--max-findings", "-1"], ["demo", "--home", "."], ["--project", ".", "--no-project"], ["--project", "does-not-exist-dir"]]) {
    const r = await runCli(args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.stderr, /^error: /, args.join(" "));
  }
});

test("--fail-on sets the exit code", async () => {
  assert.equal((await runCli(["demo", "--format", "json", "--fail-on", "critical"])).code, 1);
  assert.equal((await runCli(["demo", "--format", "json"])).code, 0);
  const dir = await tempDir();
  try {
    await writeFiles(dir, { ".mcp.json": '{"mcpServers":{"a":{"command":"node","args":["s.js"]}}}' });
    // only an info finding
    assert.equal((await runCli(["--no-user", "--project", dir, "--fail-on", "low"])).code, 0);
    assert.equal((await runCli(["--no-user", "--project", dir, "--fail-on", "info"])).code, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("--out writes a new file and refuses to overwrite without --force", async () => {
  const dir = await tempDir();
  try {
    const out = path.join(dir, "report.html");
    const a = await runCli(["demo", "--format", "html", "--out", out]);
    assert.equal(a.code, 0);
    assert.match(await fs.readFile(out, "utf8"), /^<!doctype html>/);
    assert.match(a.stdout, /Findings:/);
    const b = await runCli(["demo", "--format", "html", "--out", out]);
    assert.equal(b.code, 2);
    assert.match(b.stderr, /already exists/);
    const c = await runCli(["demo", "--format", "json", "--out", out, "--force"]);
    assert.equal(c.code, 0);
    assert.match(await fs.readFile(out, "utf8"), /^\{/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("--no-user and --no-project limit the scan", async () => {
  const dir = await tempDir();
  try {
    await writeFiles(dir, {
      "home/.cursor/mcp.json": '{"mcpServers":{"u":{"command":"node"}}}',
      "proj/.cursor/mcp.json": '{"mcpServers":{"p":{"command":"node"}}}',
    });
    const home = path.join(dir, "home");
    const proj = path.join(dir, "proj");
    const both = JSON.parse((await runCli(["--home", home, "--project", proj, "--format", "json"])).stdout);
    assert.deepEqual(both.mcpServers.map((s: { name: string }) => s.name).sort(), ["p", "u"]);
    const noUser = JSON.parse((await runCli(["--no-user", "--project", proj, "--format", "json"])).stdout);
    assert.deepEqual(noUser.mcpServers.map((s: { name: string }) => s.name), ["p"]);
    assert.equal(noUser.scan.includeUser, false);
    const noProj = JSON.parse((await runCli(["--home", home, "--no-project", "--format", "json"])).stdout);
    assert.deepEqual(noProj.mcpServers.map((s: { name: string }) => s.name), ["u"]);
    assert.equal(noProj.scan.projectName, null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("empty scan prints a clear message", async () => {
  const dir = await tempDir();
  try {
    const r = await runCli(["--home", dir, "--project", dir]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /No agent configuration files found/);
    const html = await runCli(["--home", dir, "--project", dir, "--format", "html"]);
    assert.match(html.stdout, /No agent configuration files were found/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("~/.claude.json local-scope servers are matched to the scanned project", async () => {
  const dir = await tempDir();
  try {
    const proj = path.join(dir, "proj");
    await fs.mkdir(proj);
    const claudeJson = { projects: { [proj]: { mcpServers: { mine: { command: "node" } } }, [path.join(dir, "other")]: { mcpServers: { theirs: { command: "node" } } } } };
    await writeFiles(dir, { "home/.claude.json": JSON.stringify(claudeJson) });
    const r = JSON.parse((await runCli(["--home", path.join(dir, "home"), "--project", proj, "--format", "json"])).stdout);
    assert.deepEqual(r.mcpServers.map((s: { name: string; context: string }) => `${s.name}:${s.context}`), ["mine:local scope"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("HTML escapes hostile names and values", async () => {
  const dir = await tempDir();
  try {
    await writeFiles(dir, {
      ".mcp.json": JSON.stringify({ mcpServers: { "<script>alert(1)</script>": { command: "node", args: ['"><img src=x onerror=alert(1)>'] } } }),
    });
    const html = renderHtml(await scan({ project: dir, home: null }));
    assert.equal(html.includes("<script>alert"), false);
    assert.equal(html.includes("<img src=x"), false);
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("--system reads managed locations without failing when absent", async () => {
  const dir = await tempDir();
  try {
    const r = await runCli(["--home", dir, "--project", dir, "--system", "--format", "json"]);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.stdout).scan.includeSystem, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
