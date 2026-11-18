import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { MAX_FILE_BYTES, readConfigFile } from "../src/read.js";
import { scan } from "../src/scan.js";
import type { FileFormat } from "../src/types.js";
import { analyzeInline, tempDir, writeFiles } from "./helpers.js";

const JSON_FORMATS: [FileFormat, Parameters<typeof analyzeInline>[2]][] = [
  ["claude-settings", "claude-code"],
  ["claude-global", "claude-code"],
  ["mcp-servers-json", "cursor"],
  ["vscode-mcp", "vscode"],
  ["cursor-cli", "cursor"],
  ["gemini-settings", "gemini-cli"],
];

test("invalid JSON is reported with a location, not thrown", () => {
  for (const [format, agent] of JSON_FORMATS) {
    const r = analyzeInline('{ "a": 1\n  "b": 2 }', format, agent);
    assert.equal(r.status, "error", format);
    assert.match(r.error!, /invalid JSON: .* at line 2, column 3/, format);
  }
});

test("empty and whitespace-only files are errors", () => {
  for (const [format, agent] of JSON_FORMATS) {
    assert.equal(analyzeInline("", format, agent).status, "error");
    assert.equal(analyzeInline("  \n", format, agent).status, "error");
  }
});

test("non-object top levels produce a warning and no data", () => {
  for (const [format, agent] of JSON_FORMATS) {
    for (const top of ["[]", "null", "42", '"text"', "true"]) {
      const r = analyzeInline(top, format, agent);
      assert.equal(r.status, "parsed", `${format} ${top}`);
      assert.ok(r.result.warnings.some((w) => /top level/.test(w)), `${format} ${top}`);
      assert.equal(r.result.permissions.length + r.result.mcpServers.length, 0);
    }
  }
});

test("wrong field types are ignored with warnings", () => {
  const r = analyzeInline(
    {
      permissions: { allow: "Bash", deny: [1, null, "Read(./.env)"], ask: {}, defaultMode: 7, additionalDirectories: "x" },
      hooks: [],
      env: ["A"],
      mcpServers: [],
      enabledMcpjsonServers: "x",
    },
    "claude-settings",
    "claude-code",
  );
  assert.equal(r.status, "parsed");
  assert.deepEqual(r.result.permissions.map((p) => p.rule), ["Read(./.env)"]);
  const w = r.result.warnings.join("\n");
  for (const s of ["permissions.allow should be an array", "permissions.deny has 2 non-string entries", "permissions.ask should be an array", "permissions.defaultMode should be a string", "hooks should be an object", "env should be an object", "mcpServers should be an object"]) {
    assert.ok(w.includes(s), s);
  }
});

test("malformed MCP server entries do not crash and are reported", () => {
  const r = analyzeInline(
    {
      mcpServers: {
        str: "npx foo",
        nul: null,
        noCommand: { args: ["x"] },
        badArgs: { command: "node", args: "server.js" },
        badEnv: { command: "node", env: "A=B" },
        numCommand: { command: 5 },
        weirdType: { type: "carrier-pigeon", url: "https://x.example" },
        urlNoType: { url: "https://x.example" },
        ["__proto__"]: { command: "node" },
      },
    },
    "mcp-servers-json",
    "claude-code",
  );
  assert.equal(r.status, "parsed");
  const names = r.result.mcpServers.map((s) => s.name).sort();
  assert.ok(names.includes("__proto__"));
  assert.ok(!names.includes("str") && !names.includes("nul"));
  const w = r.result.warnings.join("\n");
  for (const s of ['"str": entry should be an object', '"badArgs": args should be an array', '"badEnv": env should be an object', '"numCommand": command should be a string', 'unknown transport type "carrier-pigeon"', '"urlNoType": has a url but no type']) {
    assert.ok(w.includes(s), s);
  }
  assert.equal(({} as Record<string, unknown>).command, undefined, "no prototype pollution");
});

test("comments in strict-JSON formats parse with a warning", () => {
  const r = analyzeInline('// note\n{ "permissions": { "allow": ["Bash(ls)",] } }', "claude-settings", "claude-code");
  assert.equal(r.status, "parsed");
  assert.ok(r.result.warnings.some((w) => /strict JSON/.test(w)));
  const v = analyzeInline('// note\n{ "servers": {} }', "vscode-mcp", "vscode");
  assert.deepEqual(v.result.warnings, []);
});

test("unrecognized rules and modes are kept and flagged", () => {
  const r = analyzeInline({ permissions: { allow: ["Bash(unclosed", "mcp__x__y(arg)"], defaultMode: "turbo" } }, "claude-settings", "claude-code");
  const w = r.result.warnings.join("\n");
  assert.match(w, /could not parse rule "Bash\(unclosed"/);
  assert.match(w, /skips mcp__ rules with parentheses/);
  assert.match(w, /unrecognized value "turbo"/);
  const c = analyzeInline({ permissions: { allow: ["Bogus(x)", "Shell"] } }, "cursor-cli", "cursor");
  assert.equal(c.result.warnings.length, 2);
});

test("invalid TOML is reported, wrong TOML types are ignored", () => {
  const bad = analyzeInline('approval_policy = "never\n', "codex-toml", "codex");
  assert.equal(bad.status, "error");
  assert.match(bad.error!, /invalid TOML/);
  const dup = analyzeInline('a = 1\na = 2\n', "codex-toml", "codex");
  assert.equal(dup.status, "error");
  const types = analyzeInline('sandbox_mode = 3\nsandbox_workspace_write = "x"\nprofiles = 1\nmcp_servers = [1]\n', "codex-toml", "codex");
  assert.equal(types.status, "parsed");
  const w = types.result.warnings.join("\n");
  assert.match(w, /sandbox_workspace_write should be a table/);
  assert.match(w, /profiles should be a table/);
  assert.match(w, /mcp_servers should be an object/);
  assert.equal(analyzeInline("", "codex-toml", "codex").status, "parsed");
});

test("deeply nested JSON does not crash", () => {
  const deep = "[".repeat(5000) + "]".repeat(5000);
  const r = analyzeInline(`{"mcpServers": {"a": {"command": "node", "args": ${deep}}}}`, "mcp-servers-json", "cursor");
  assert.equal(r.status, "parsed");
});

test("readConfigFile: missing, directory, BOM, invalid UTF-8, oversize", async () => {
  const dir = await tempDir();
  try {
    assert.equal((await readConfigFile(path.join(dir, "nope.json"))).kind, "missing");
    assert.equal((await readConfigFile(path.join(dir, "nope", "deeper.json"))).kind, "missing");
    await fs.mkdir(path.join(dir, "adir.json"));
    const d = await readConfigFile(path.join(dir, "adir.json"));
    assert.equal(d.kind, "error");
    await writeFiles(dir, {
      "bom.json": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}')]),
      "latin1.json": Buffer.from([0x7b, 0x22, 0xe9, 0x22, 0x7d]),
    });
    const bom = await readConfigFile(path.join(dir, "bom.json"));
    assert.deepEqual(bom, { kind: "ok", text: '{"a":1}' });
    const latin = await readConfigFile(path.join(dir, "latin1.json"));
    assert.deepEqual(latin, { kind: "error", error: "file is not valid UTF-8" });
    const big = path.join(dir, "big.json");
    const fh = await fs.open(big, "w");
    await fh.truncate(MAX_FILE_BYTES + 1);
    await fh.close();
    const b = await readConfigFile(big);
    assert.equal(b.kind, "error");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a scan with broken files still reports the rest", async () => {
  const dir = await tempDir();
  try {
    const home = path.join(dir, "home");
    const project = path.join(dir, "proj");
    await writeFiles(dir, {
      "home/.claude/settings.json": "{ not json",
      "home/.codex/config.toml": "= broken",
      "home/.cursor/mcp.json": Buffer.from([0xff, 0xfe, 0x00]),
      "proj/.mcp.json": '{"mcpServers":{"ok":{"command":"node","args":["s.js"]}}}',
    });
    await fs.mkdir(path.join(project, ".vscode", "mcp.json"), { recursive: true });
    const report = await scan({ home, project, env: {} });
    assert.equal(report.summary.sourcesWithErrors, 4);
    assert.equal(report.summary.mcpServers, 1);
    assert.equal(report.findings.filter((f) => f.ruleId === "source.unreadable").length, 4);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
