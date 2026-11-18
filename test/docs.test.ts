import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO } from "./helpers.js";

async function sourceText(dir: string): Promise<string> {
  let out = "";
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out += await sourceText(p);
    else if (e.name.endsWith(".ts")) out += await fs.readFile(p, "utf8");
  }
  return out;
}

test("docs/rules.md documents every rule and nothing else", async () => {
  const src = await sourceText(path.join(REPO, "src"));
  const inSource = new Set([...src.matchAll(/ruleId: "([a-z.-]+)"/g)].map((m) => m[1]!));
  const doc = await fs.readFile(path.join(REPO, "docs", "rules.md"), "utf8");
  const inDocs = new Set([...doc.matchAll(/^\| `([a-z]+\.[a-z.-]+)` \|/gm)].map((m) => m[1]!));
  assert.deepEqual([...inSource].sort(), [...inDocs].sort());
});

test("examples in the README match the demo report", async () => {
  const readme = await fs.readFile(path.join(REPO, "README.md"), "utf8");
  const txt = await fs.readFile(path.join(REPO, "examples", "demo-report.txt"), "utf8");
  for (const marker of ["Scanned ", " permission rules, ", "Findings: "]) {
    const fromReport = txt.split("\n").find((l) => l.includes(marker));
    assert.ok(fromReport, `demo report has no line containing "${marker}"`);
    assert.ok(readme.includes(fromReport), `README is missing: ${fromReport}`);
  }
});
