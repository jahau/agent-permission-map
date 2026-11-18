// Preload used by test/safety.test.ts. Replaces network and subprocess entry
// points with functions that report and exit, so any attempt fails the test.
import { createRequire, syncBuiltinESMExports } from "node:module";

const require = createRequire(import.meta.url);

function blocker(what) {
  return function blocked() {
    process.stderr.write(`BLOCKED ${what}\n`);
    process.exit(99);
  };
}

const net = require("node:net");
net.connect = net.createConnection = blocker("net");
net.Socket.prototype.connect = blocker("net");
const tls = require("node:tls");
tls.connect = blocker("tls");
for (const name of ["node:http", "node:https"]) {
  const m = require(name);
  m.request = m.get = blocker(name);
}
const dns = require("node:dns");
dns.lookup = dns.resolve = blocker("dns");
dns.promises.lookup = dns.promises.resolve = blocker("dns");
const dgram = require("node:dgram");
dgram.createSocket = blocker("dgram");
const cp = require("node:child_process");
for (const fn of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) cp[fn] = blocker(`child_process.${fn}`);
globalThis.fetch = blocker("fetch");
globalThis.WebSocket = blocker("WebSocket");
syncBuiltinESMExports();
