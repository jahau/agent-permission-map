import assert from "node:assert/strict";
import { test } from "node:test";
import { isInlineSecret, redactArgs, redactText, redactUrl, REDACTED } from "../src/redact.js";

// Token-shaped strings are assembled at runtime so this file never contains one literally.
const fakeGithub = "gh" + "p_" + "A".repeat(36);
const fakeOpenAi = "sk" + "-" + "proj" + "B".repeat(40);

test("references are not secrets", () => {
  for (const v of ["${API_KEY}", "${env:API_KEY}", "${input:token}", "$TOKEN", "%TOKEN%", "Bearer ${API_KEY}", "${API_KEY:-}"]) {
    assert.equal(isInlineSecret("API_KEY", v), false, v);
  }
});

test("literal values under secret-looking names are secrets", () => {
  assert.equal(isInlineSecret("GITHUB_TOKEN", "abcdef123456"), true);
  assert.equal(isInlineSecret("Authorization", "Bearer abcdef123456"), true);
  assert.equal(isInlineSecret("password", "hunter2hunter2"), true);
});

test("placeholders and non-secret names are ignored", () => {
  assert.equal(isInlineSecret("API_KEY", "<your key>"), false);
  assert.equal(isInlineSecret("API_KEY", "your-api-key"), false);
  assert.equal(isInlineSecret("API_KEY", ""), false);
  assert.equal(isInlineSecret("LOG_LEVEL", "debug-verbose"), false);
  assert.equal(isInlineSecret("API_KEY", 42), false);
});

test("token shapes are secrets under any name", () => {
  assert.equal(isInlineSecret("X", fakeGithub), true);
  assert.equal(isInlineSecret("X", fakeOpenAi), true);
});

test("redactText removes token shapes and flag values", () => {
  const out = redactText(`run --token=abc123def ${fakeGithub} --api-key secretvalue -H "Authorization: Bearer abcdefghijk"`);
  assert.ok(!out.includes(fakeGithub));
  assert.ok(!out.includes("abc123def"));
  assert.ok(!out.includes("secretvalue"));
  assert.ok(!out.includes("abcdefghijk"));
  assert.ok(out.includes("--token=" + REDACTED));
});

test("redactText keeps variable references", () => {
  assert.equal(redactText("--token=$TOKEN"), "--token=$TOKEN");
});

test("redactArgs redacts flag values, env-style args and connection strings", () => {
  const { args, redacted } = redactArgs([
    "--api-key",
    "plainsecretvalue",
    "--password=hunter2hunter2",
    "API_TOKEN=abcdef123456",
    "postgresql://user:pw123@db.example/app",
    "--port",
    "8080",
    "--token",
    "${TOKEN}",
  ]);
  assert.deepEqual(args, [
    "--api-key",
    REDACTED,
    `--password=${REDACTED}`,
    `API_TOKEN=${REDACTED}`,
    `postgresql://${REDACTED}@db.example/app`,
    "--port",
    "8080",
    "--token",
    "${TOKEN}",
  ]);
  assert.equal(redacted, 4);
});

test("redactArgs stringifies non-string args without throwing", () => {
  assert.deepEqual(redactArgs([1, true, null]).args, ["1", "true", "null"]);
});

test("redactUrl removes userinfo and query values", () => {
  const r = redactUrl("https://u:p@mcp.example.com/sse?apiKey=abcdef123456&region=eu");
  assert.equal(r.url, `https://${REDACTED}@mcp.example.com/sse?apiKey=${REDACTED}&region=${REDACTED}`);
  assert.equal(r.hadCredentials, true);
  const clean = redactUrl("https://mcp.example.com/mcp");
  assert.equal(clean.url, "https://mcp.example.com/mcp");
  assert.equal(clean.hadCredentials, false);
});

test("redactUrl tolerates unparseable and templated URLs", () => {
  const r = redactUrl("${API_BASE_URL:-https://api.example.com}/mcp");
  assert.equal(r.url, "${API_BASE_URL:-https://api.example.com}/mcp");
  assert.equal(r.hadCredentials, false);
});

test("redactTokensDeep reaches every string, including keys, without prototype tricks", async () => {
  const { redactTokensDeep } = await import("../src/redact.js");
  const input = JSON.parse(`{"a":["x ${fakeGithub}"],"__proto__":{"b":"${fakeOpenAi}"},"n":1,"z":null}`) as Record<string, unknown>;
  const out = redactTokensDeep(input);
  const text = JSON.stringify(out);
  assert.ok(!text.includes(fakeGithub) && !text.includes(fakeOpenAi));
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.ok(Object.prototype.hasOwnProperty.call(out, "__proto__"));
});
