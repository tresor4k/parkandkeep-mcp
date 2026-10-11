#!/usr/bin/env node
/**
 * Smoke test of the Streamable HTTP endpoint (dist/http.js): initialize, tools/list, then every tool on 3 airports.
 * Expected values are read from the bundled index JSON, never typed by hand. Also checks that no tool output carries
 * a price next to an operator, and that every link points to parkandkeep.com (hub links with utm_source=mcp).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = JSON.parse(fs.readFileSync(path.join(root, "dist", "data", "index.json"), "utf8"));
const PORT = Number(process.env.PORT ?? 8798);
const URL_ = `http://127.0.0.1:${PORT}/mcp`;

const child = spawn(process.execPath, [path.join(root, "dist", "http.js")], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((resolve, reject) => {
  child.stdout.on("data", (d) => String(d).includes("listening") && resolve());
  child.on("exit", (code) => reject(new Error(`server exited early (${code})`)));
  setTimeout(() => reject(new Error("server start timeout")), 10000);
});

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) failures++;
  if (!cond || process.env.VERBOSE) console.log(`${cond ? "OK" : "FAIL"}: ${msg}`);
};

let id = 0;
async function rpc(method, params, headers = {}) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  return { status: res.status, body: await res.json() };
}
const call = async (name, args) => (await rpc("tools/call", { name, arguments: args })).body.result;

const strings = (v, out = []) => {
  if (typeof v === "string") out.push(v);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
};
const keys = (v, out = new Set()) => {
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.add(k), keys(x, out));
  return out;
};
const PRICE_KEYS = ["d3", "d7", "d14", "price", "prices_d3", "min", "median", "max"];
const median = (s) => (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);
const r2 = (x) => Math.round(x * 100) / 100;

function checkLinks(payload, label) {
  const urls = strings(payload).filter((s) => /^https?:\/\//.test(s));
  assert(urls.length > 0, `${label}: has links`);
  for (const u of urls) assert(new URL(u).hostname === "parkandkeep.com", `${label}: link on parkandkeep.com (${u})`);
  assert(urls.some((u) => new URL(u).searchParams.get("utm_source") === "mcp"), `${label}: hub link with utm_source=mcp`);
  assert(!urls.some((u) => /aff|partner|ref=|clickid|awin|tradedoubler/i.test(u)), `${label}: no affiliate link`);
}

try {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
  assert(init.status === 200 && init.body.result?.serverInfo?.name === "parkandkeep-mcp", "initialize");
  assert(/never quote a price for a named operator/.test(init.body.result?.instructions ?? ""), "instructions");
  const scan = await rpc("tools/list", {}, { accept: "application/json", "mcp-protocol-version": "2099-01-01" });
  assert(scan.status === 200, `scanner headers (Accept json alone, unknown protocol) -> ${scan.status}`);

  const list = (await rpc("tools/list", {})).body.result.tools;
  const names = list.map((t) => t.name).sort();
  assert(JSON.stringify(names) === JSON.stringify(["airport_market_snapshot", "airport_parking_options", "airport_price_snapshot"]), `tools/list: ${names}`);
  for (const t of list) assert(t.annotations?.readOnlyHint === true && !/open source/i.test(t.description), `${t.name}: read-only, wording`);

  // 3 airports with the most priced listings (so that aggregates are exercised), chosen from the data.
  const picked = [...INDEX.airports].sort((a, b) => b.prices_collected - a.prices_collected || a.iata.localeCompare(b.iata)).slice(0, 3);
  for (const a of picked) {
    const L = INDEX.listings.filter((l) => l.airport.iata === a.iata);
    const names = new Set(L.map((l) => l.name));

    const opt = (await call("airport_parking_options", { airport: a.iata.toLowerCase() })).structuredContent;
    assert(opt.airport.iata === a.iata && opt.operators_count === a.parkings && opt.operators.length === a.parkings, `${a.iata} options: ${opt.operators_count} operators`);
    assert(!PRICE_KEYS.some((k) => keys(opt.operators).has(k)), `${a.iata} options: no price per operator`);
    checkLinks(opt, `${a.iata} options`);

    const res = await call("airport_price_snapshot", { airport: a.iata });
    const snap = res.structuredContent;
    assert(!strings(snap).some((s) => names.has(s)), `${a.iata} price: no operator named`);
    assert(snap.aggregates.every((g) => g.prices >= 3), `${a.iata} price: every aggregate from >= 3 prices`);
    for (const [d, days] of [["d3", 3], ["d7", 7], ["d14", 14]]) {
      const byCur = {};
      for (const l of L) if (l.price[d] != null && l.price.currency) (byCur[l.price.currency] ??= []).push(l.price[d]);
      for (const [cur, v] of Object.entries(byCur)) {
        const g = snap.aggregates.find((x) => x.stay_days === days && x.currency === cur);
        if (v.length < 3) {
          assert(!g, `${a.iata} ${d} ${cur}: no aggregate under 3 prices`);
          continue;
        }
        const s = [...v].sort((x, y) => x - y);
        assert(g && g.min === r2(s[0]) && g.median === r2(median(s)) && g.max === r2(s.at(-1)) && g.prices === s.length, `${a.iata} ${d} ${cur}: ${JSON.stringify(g)}`);
        if (Object.keys(byCur).length === 1 && a.prices[d])
          assert(g.min === a.prices[d].min && g.median === a.prices[d].median && g.max === a.prices[d].max, `${a.iata} ${d}: matches airports[].prices`);
      }
    }
    checkLinks(snap, `${a.iata} price`);

    const mk = (await call("airport_market_snapshot", { airport: a.city })).structuredContent;
    assert(
      mk.airport.iata === a.iata && mk.operators === a.parkings && mk.share_shuttle === a.share_shuttle && mk.share_valet === a.share_valet &&
        mk.distance_km_median === a.distance_km_median && mk.operators_with_prices === a.prices_collected,
      `${a.iata} market (looked up by name "${a.city}")`,
    );
    assert(!PRICE_KEYS.some((k) => keys(mk).has(k)), `${a.iata} market: no price`);
    checkLinks(mk, `${a.iata} market`);
    console.log(`${a.iata}: ${opt.operators_count} operators, ${snap.aggregates.length} aggregate(s)`);
  }

  const unknown = await call("airport_price_snapshot", { airport: "Atlantis" });
  assert(unknown.isError === true, "unknown airport -> isError");
} finally {
  child.kill();
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
