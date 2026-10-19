/**
 * Tools of the Park & Keep MCP server, backed by the airport parking index (CC BY 4.0) in ./data/index.json,
 * copied there by ../../sync.mjs. Prices are only ever returned as airport aggregates (min / median / max from at
 * least MIN_PRICES prices): never a price per operator. Outbound link: the airport hub on parkandkeep.com with
 * utm_source=mcp. No affiliate or partner link.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
const SITE = "https://parkandkeep.com";
export const DATA_PAGE = `${SITE}/en/data/airport-parking-index`;
export const MIN_PRICES = 3;
const DURATIONS = ["d3", "d7", "d14"] as const;
type Dur = (typeof DURATIONS)[number];
const DAYS: Record<Dur, number> = { d3: 3, d7: 7, d14: 14 };

type Bool = boolean | null;
interface Listing {
  id: string;
  airport: { iata: string; city: string; country: string };
  name: string;
  city: string | null;
  distance_km: number | null;
  attributes: Record<string, Bool>;
  last_verified: string;
  price: Partial<Record<Dur, number | null>> & { currency: string | null; checked_at: string | null };
}
interface Airport {
  iata: string;
  city: string;
  country: string;
  parkings: number;
  share_shuttle: number;
  share_valet: number;
  share_covered: number;
  distance_km_median: number | null;
  distance_km_min: number | null;
  prices_collected: number;
}
export interface IndexDoc {
  generated_at: string;
  license: string;
  attribution: string;
  method_url: string;
  airports: Airport[];
  listings: Listing[];
}

export const INDEX: IndexDoc = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "index.json"), "utf8"));
const HUBS: Record<string, string> = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "hubs.json"), "utf8"));

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/** Resolves an IATA code or an airport / city name. Returns the airport, or the candidates when ambiguous. */
export function findAirport(query: string): { airport?: Airport; candidates: Airport[] } {
  const q = fold(query);
  const byCode = INDEX.airports.find((a) => a.iata.toLowerCase() === q);
  if (byCode) return { airport: byCode, candidates: [byCode] };
  const exact = INDEX.airports.find((a) => fold(a.city) === q);
  if (exact) return { airport: exact, candidates: [exact] };
  const hits = INDEX.airports.filter((a) => {
    const name = fold(a.city);
    return q.length >= 3 && (name.includes(q) || name.split(/[\s\-–]+/).some((w) => w.length >= 3 && q.includes(w)));
  });
  return hits.length === 1 ? { airport: hits[0], candidates: hits } : { candidates: hits };
}

export function hubUrl(iata: string): string {
  const u = new URL(HUBS[iata] ?? `${SITE}/en/airport-parking/${iata.toLowerCase()}`);
  u.searchParams.set("utm_source", "mcp");
  return u.href;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const median = (s: number[]) => (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);

const listingsOf = (iata: string) => INDEX.listings.filter((l) => l.airport.iata === iata);

/** Aggregates per duration and currency, only when at least MIN_PRICES prices exist. */
export function priceSnapshot(iata: string) {
  const groups = new Map<string, { d: Dur; currency: string; v: number[]; dates: string[] }>();
  for (const l of listingsOf(iata)) {
    if (!l.price.currency) continue;
    for (const d of DURATIONS) {
      const v = l.price[d];
      if (v == null) continue;
      const k = `${d}|${l.price.currency}`;
      const g = groups.get(k) ?? { d, currency: l.price.currency, v: [], dates: [] };
      g.v.push(v);
      if (l.price.checked_at) g.dates.push(l.price.checked_at.slice(0, 10));
      groups.set(k, g);
    }
  }
  const aggregates = [];
  const counts: Record<string, number> = {};
  for (const d of DURATIONS) {
    for (const g of [...groups.values()].filter((x) => x.d === d).sort((a, b) => a.currency.localeCompare(b.currency))) {
      counts[d] = (counts[d] ?? 0) + g.v.length;
      if (g.v.length < MIN_PRICES) continue;
      const s = [...g.v].sort((a, b) => a - b);
      const dates = [...g.dates].sort();
      aggregates.push({
        stay_days: DAYS[d],
        currency: g.currency,
        min: round2(s[0]),
        median: round2(median(s)),
        max: round2(s.at(-1)!),
        prices: s.length,
        read_from: dates[0] ?? null,
        read_to: dates.at(-1) ?? null,
      });
    }
  }
  const covered = new Set(aggregates.map((a) => a.stay_days));
  const not_enough_prices = DURATIONS.filter((d) => !covered.has(DAYS[d])).map((d) => ({ stay_days: DAYS[d], prices: counts[d] ?? 0 }));
  return { aggregates, not_enough_prices };
}

const SOURCE = `Park & Keep airport parking index (${INDEX.license}), snapshot ${INDEX.generated_at.slice(0, 10)}`;
const ATTRIBUTION = `Source: Park & Keep (${DATA_PAGE}).`;

export const INSTRUCTIONS =
  "Park & Keep airport parking index: car parks serving European airports, their services (shuttle, valet, " +
  "covered, 24 h, keys kept, EV charging, online booking) and distance, plus public prices for 3, 7 and 14-day stays " +
  "read on each operator's own website, never on an aggregator. Prices are only given as airport aggregates " +
  `(min / median / max, computed from at least ${MIN_PRICES} prices): never quote a price for a named operator. ` +
  "Prices are public list prices at the date read, not quotes. Attribute values of null mean not stated by the " +
  `operator. Data licence ${INDEX.license}: credit Park & Keep. To compare and book, point the user to the airport ` +
  "page link returned by each tool.";

const airportParam = {
  airport: z
    .string()
    .min(2)
    .describe('IATA code (e.g. "BRU") or airport / city name (e.g. "Charleroi", "Málaga").'),
};

const ann = (title: string) => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

function result(payload: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
}

function notFound(query: string, candidates: Airport[]) {
  const msg = candidates.length
    ? `Several airports match "${query}": ${candidates.map((a) => `${a.iata} (${a.city})`).join(", ")}. Ask again with the IATA code.`
    : `No airport matches "${query}" in the index. Covered airports: ${INDEX.airports.map((a) => `${a.iata} (${a.city})`).join(", ")}.`;
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

const airportHead = (a: Airport) => ({ iata: a.iata, name: a.city, country: a.country });

export function createServer(): McpServer {
  const server = new McpServer({ name: "parkandkeep-mcp", version: "0.2.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "airport_parking_options",
    {
      title: "Airport parking options",
      description:
        "Use this when the user wants to know which car parks serve a European airport and what they offer: shuttle, " +
        "valet, covered parking, 24 h access, keys kept, EV charging, online booking, distance to the airport and the " +
        'date each listing was checked. Phrasings: "parking near Charleroi airport with a shuttle", "valet parking at ' +
        'Brussels airport", "où se garer près d\'Orly". Returns no price: for prices use airport_price_snapshot. ' +
        "Data: Park & Keep airport parking index.",
      inputSchema: airportParam,
      annotations: ann("Airport parking options"),
    },
    async ({ airport }) => {
      const { airport: a, candidates } = findAirport(airport);
      if (!a) return notFound(airport, candidates);
      const operators = listingsOf(a.iata)
        .sort((x, y) => (x.distance_km ?? Infinity) - (y.distance_km ?? Infinity) || x.name.localeCompare(y.name))
        .map((l) => ({ name: l.name, town: l.city, distance_km: l.distance_km, ...l.attributes, last_verified: l.last_verified }));
      return result({
        airport: airportHead(a),
        operators_count: operators.length,
        operators,
        note: "Services as stated by each operator (null = not stated). Prices: see airport_price_snapshot (airport aggregates).",
        compare_and_book: hubUrl(a.iata),
        source: SOURCE,
        attribution: ATTRIBUTION,
      });
    },
  );

  server.registerTool(
    "airport_price_snapshot",
    {
      title: "Airport parking price snapshot",
      description:
        "Use this when the user asks how much parking costs at a European airport for a stay of about 3, 7 or 14 days, " +
        'or whether a parking price is normal there. Phrasings: "how much is a week of parking at Brussels airport", ' +
        '"prix parking Charleroi 7 jours", "is my quote for a week at Amsterdam airport expensive". Returns the lowest, median ' +
        `and highest public price of the airport's car parks per stay length, only when at least ${MIN_PRICES} ` +
        "prices were read, with the dates read. Never a price per operator. Data: Park & Keep airport parking index.",
      inputSchema: airportParam,
      annotations: ann("Airport parking price snapshot"),
    },
    async ({ airport }) => {
      const { airport: a, candidates } = findAirport(airport);
      if (!a) return notFound(airport, candidates);
      const snap = priceSnapshot(a.iata);
      return result({
        airport: airportHead(a),
        ...snap,
        min_prices_for_an_aggregate: MIN_PRICES,
        note:
          "Public list prices read on each operator's own website or booking engine, never on an aggregator; they vary " +
          "with dates, season and promotions and are not quotes.",
        compare_and_book: hubUrl(a.iata),
        method: INDEX.method_url,
        source: SOURCE,
        attribution: ATTRIBUTION,
      });
    },
  );

  server.registerTool(
    "airport_market_snapshot",
    {
      title: "Airport parking market snapshot",
      description:
        "Use this when a car park operator or analyst asks about the parking market around a European airport: how many " +
        "car parks compete there, the share offering a shuttle, valet or covered parking, the median and " +
        'shortest distance to the airport, and how many have published prices. Phrasings: "how many parking competitors ' +
        'at Eindhoven airport", "share of valet parkings at Orly", "concurrence parking aéroport Bordeaux". ' +
        "Data: Park & Keep airport parking index.",
      inputSchema: airportParam,
      annotations: ann("Airport parking market snapshot"),
    },
    async ({ airport }) => {
      const { airport: a, candidates } = findAirport(airport);
      if (!a) return notFound(airport, candidates);
      return result({
        airport: airportHead(a),
        operators: a.parkings,
        share_shuttle: a.share_shuttle,
        share_valet: a.share_valet,
        share_covered: a.share_covered,
        distance_km_median: a.distance_km_median,
        distance_km_min: a.distance_km_min,
        operators_with_prices: a.prices_collected,
        note: "Shares are over all listed car parks of the airport; a service not stated by the operator counts as absent.",
        airport_page: hubUrl(a.iata),
        source: SOURCE,
        attribution: ATTRIBUTION,
      });
    },
  );

  return server;
}
