// Regenerate examples/demo-report.{json,html,txt} from the bundled fixtures.
// Run `npm run demo:write`, then review the diff: these files are golden outputs
// that the test suite compares against byte for byte.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../dist/cli.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repo, "examples");
await fs.mkdir(outDir, { recursive: true });

for (const [format, file] of [["json", "demo-report.json"], ["html", "demo-report.html"], ["text", "demo-report.txt"]]) {
  let stdout = "";
  const code = await main(["demo", "--format", format], { stdout: (s) => (stdout += s), stderr: (s) => process.stderr.write(s), cwd: repo });
  if (code !== 0) throw new Error(`demo --format ${format} exited ${code}`);
  await fs.writeFile(path.join(outDir, file), stdout);
  console.log(`wrote examples/${file}`);
}
