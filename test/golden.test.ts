import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { renderJson } from "../src/render/json.js";
import { scan } from "../src/scan.js";
import { DEMO, REPO, runCli } from "./helpers.js";

// Regenerate with `npm run demo:write` after an intended change, and review the diff.
const EXAMPLES = path.join(REPO, "examples");

for (const [format, file] of [
  ["json", "demo-report.json"],
  ["html", "demo-report.html"],
  ["text", "demo-report.txt"],
] as const) {
  test(`demo ${format} report matches examples/${file}`, async () => {
    const expected = await fs.readFile(path.join(EXAMPLES, file), "utf8");
    const r = await runCli(["demo", "--format", format]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, expected);
  });
}

test("repeated scans are byte-identical", async () => {
  const opts = { project: path.join(DEMO, "acme-api"), home: path.join(DEMO, "home"), env: {} };
  const a = renderJson(await scan(opts));
  const b = renderJson(await scan(opts));
  assert.equal(a, b);
});

test("reports contain no absolute paths, timestamps or machine details", async () => {
  const r = await runCli(["demo", "--format", "json"]);
  const repoPosix = REPO.replace(/\\/g, "/");
  assert.equal(r.stdout.includes(repoPosix), false);
  assert.equal(r.stdout.includes(REPO), false);
  assert.doesNotMatch(r.stdout, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  assert.doesNotMatch(r.stdout, /"(platform|hostname|user|username|generatedAt|timestamp)"\s*:/);
});

test("HTML report is self-contained and script-free", async () => {
  const html = (await runCli(["demo", "--format", "html"])).stdout;
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  assert.doesNotMatch(html, /<script|<link|<img|<iframe|https?:\/\/[^"'\s<]*\.(js|css)\b|@import|url\(/i);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
});
