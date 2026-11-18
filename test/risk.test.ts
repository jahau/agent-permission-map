import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeShellSpec, containerMountSources, isPinned, packageSpecFor, shellAllowFinding } from "../src/risk.js";

test("whole-shell specs are unrestricted", () => {
  for (const spec of [null, "*", "**", "", ":*"]) assert.equal(analyzeShellSpec(spec).unrestricted, true, String(spec));
});

test("wildcards right after a program are open-ended", () => {
  assert.equal(analyzeShellSpec("python *").openEnded, true);
  assert.equal(analyzeShellSpec("curl:*").openEnded, true);
  assert.equal(analyzeShellSpec("npm run *").openEnded, true);
  assert.equal(analyzeShellSpec("docker run *").openEnded, true);
  assert.equal(analyzeShellSpec("git push *").openEnded, true);
});

test("wildcards after a fixed subcommand are not open-ended", () => {
  assert.equal(analyzeShellSpec("git diff *").openEnded, false);
  assert.equal(analyzeShellSpec("npm run test *").openEnded, false);
  assert.equal(analyzeShellSpec("python scripts/build.py *").openEnded, false);
  assert.equal(analyzeShellSpec("npm test").openEnded, false);
});

test("program names are normalized", () => {
  assert.equal(analyzeShellSpec("/usr/bin/python3 *").program, "python3");
  assert.equal(analyzeShellSpec("C:\\Tools\\curl *").program, "curl");
});

test("shellAllowFinding severity by category", () => {
  assert.equal(shellAllowFinding("Bash", null, "user", "X")?.ruleId, "shell.allow-all");
  assert.equal(shellAllowFinding("Bash(node *)", "node *", "user", "X")?.severity, "high");
  assert.equal(shellAllowFinding("Bash(wget *)", "wget *", "user", "X")?.ruleId, "shell.allow-network-tool");
  assert.equal(shellAllowFinding("Bash(make *)", "make *", "user", "X")?.ruleId, "shell.allow-script-runner");
  assert.equal(shellAllowFinding("Bash(rm *)", "rm *", "user", "X")?.ruleId, "shell.allow-destructive");
  assert.equal(shellAllowFinding("Bash(ls *)", "ls *", "user", "X"), null);
  assert.equal(shellAllowFinding("Bash(npm test)", "npm test", "user", "X"), null);
});

test("project scope adds the shared-file note", () => {
  const f = shellAllowFinding("Bash", null, "project", "X");
  assert.match(f!.explanation, /shared through the repository/);
  assert.doesNotMatch(shellAllowFinding("Bash", null, "user", "X")!.explanation, /shared through the repository/);
});

test("packageSpecFor finds the downloaded package", () => {
  assert.deepEqual(packageSpecFor("npx", ["-y", "@scope/pkg"]), { runner: "npx", pkg: "@scope/pkg" });
  assert.deepEqual(packageSpecFor("npx.cmd", ["--yes", "pkg@1.0.0", "--flag"]), { runner: "npx", pkg: "pkg@1.0.0" });
  assert.deepEqual(packageSpecFor("npx", ["-p", "pkg@2.0.0", "bin"]), { runner: "npx", pkg: "pkg@2.0.0" });
  assert.deepEqual(packageSpecFor("uvx", ["--from", "git+https://x/y", "tool"]), { runner: "uvx", pkg: "git+https://x/y" });
  assert.deepEqual(packageSpecFor("pnpm", ["dlx", "pkg"]), { runner: "pnpm", pkg: "pkg" });
  assert.equal(packageSpecFor("pnpm", ["install"]), null);
  assert.equal(packageSpecFor("node", ["server.js"]), null);
});

test("isPinned", () => {
  assert.equal(isPinned("pkg@1.2.3", "npx"), true);
  assert.equal(isPinned("@scope/pkg@1.2.3-beta.1", "npx"), true);
  assert.equal(isPinned("@scope/pkg", "npx"), false);
  assert.equal(isPinned("pkg@latest", "npx"), false);
  assert.equal(isPinned("pkg@^1.2.0", "npx"), false);
  assert.equal(isPinned("./local", "npx"), true);
  assert.equal(isPinned("mcp-server-time==2025.8.4", "uvx"), true);
  assert.equal(isPinned("mcp-server-time@1.0", "uvx"), true);
  assert.equal(isPinned("mcp-server-time", "uvx"), false);
});

test("containerMountSources parses -v, --volume and --mount", () => {
  assert.deepEqual(containerMountSources(["run", "-v", "/:/host", "--volume=./data:/data", "--mount", "type=bind,source=/var/run/docker.sock,target=/s", "-vC:\\Users\\me:/w"]), [
    "/",
    "./data",
    "/var/run/docker.sock",
    "C:\\Users\\me",
  ]);
});
