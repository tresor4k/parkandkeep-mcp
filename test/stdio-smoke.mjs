#!/usr/bin/env node
/**
 * Smoke test of the stdio entry point (dist/stdio.js, the npm `bin`): initialize, tools/list (same tools as the remote
 * endpoint) and one tool call checked against the bundled index JSON.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const INDEX = JSON.parse(fs.readFileSync(path.join(root, "dist", "data", "index.json"), "utf8"));

const child = spawn(process.execPath, [path.join(root, pkg.bin["parkandkeep-mcp"])], { stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map();
readline.createInterface({ input: child.stdout }).on("line", (line) => {
  const msg = JSON.parse(line);
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});
let id = 0;
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
    setTimeout(() => reject(new Error(`${method}: timeout`)), 10000).unref();
  });

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) failures++;
  console.log(`${cond ? "OK" : "FAIL"}: stdio ${msg}`);
};

try {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
  assert(init.result?.serverInfo?.name === "parkandkeep-mcp", "initialize");
  assert(init.result?.serverInfo?.version === pkg.version, `server version = package version (${pkg.version})`);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const names = (await rpc("tools/list", {})).result.tools.map((t) => t.name).sort();
  assert(JSON.stringify(names) === JSON.stringify(["airport_market_snapshot", "airport_parking_options", "airport_price_snapshot"]), `tools/list: ${names}`);

  const a = [...INDEX.airports].sort((x, y) => y.prices_collected - x.prices_collected || x.iata.localeCompare(y.iata))[0];
  const mk = (await rpc("tools/call", { name: "airport_market_snapshot", arguments: { airport: a.iata } })).result.structuredContent;
  assert(mk.airport.iata === a.iata && mk.operators === a.parkings && mk.operators_with_prices === a.prices_collected, `${a.iata} market snapshot`);
} catch (err) {
  failures++;
  console.log(`FAIL: stdio ${err.message}`);
} finally {
  child.kill();
}
if (failures) {
  console.log(`${failures} stdio failure(s)`);
  process.exit(1);
}
console.log("stdio smoke test passed");
