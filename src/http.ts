/**
 * Streamable HTTP entry point (stateless, JSON responses), same transport as realdentalcosts-mcp.
 *
 * - handleMcp(req, res, parsedBody?) is the reusable handler (api/mcp.ts on Vercel, POST /mcp).
 * - `node dist/http.js` starts a local server on PORT (default 8787): /mcp and the static pages of public/.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";

import { createServer } from "./tools.js";

function jsonRpcError(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json", ...(status === 405 ? { allow: "POST" } : {}) });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

// The SDK transport reads the raw headers too: set both views of a header.
function setHeader(req: http.IncomingMessage, name: string, value: string): void {
  req.headers[name] = value;
  const raw = req.rawHeaders;
  const kept: string[] = [];
  for (let i = 0; i < raw.length; i += 2) if (raw[i].toLowerCase() !== name) kept.push(raw[i], raw[i + 1]);
  req.rawHeaders = [...kept, name, value];
}

/** Scanners do not all send the headers the SDK checks strictly: serve any JSON-RPC POST (see realdentalcosts-mcp). */
export function normalizeHeaders(req: http.IncomingMessage): void {
  const accept = String(req.headers.accept ?? "");
  if (!accept.includes("application/json") || !accept.includes("text/event-stream"))
    setHeader(req, "accept", "application/json, text/event-stream");
  const version = req.headers["mcp-protocol-version"];
  if (typeof version === "string" && !SUPPORTED_PROTOCOL_VERSIONS.includes(version))
    setHeader(req, "mcp-protocol-version", LATEST_PROTOCOL_VERSION);
}

export async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse, parsedBody?: unknown): Promise<void> {
  if (req.method !== "POST") {
    jsonRpcError(res, 405, "Method not allowed: this stateless MCP endpoint only accepts POST.");
    return;
  }
  normalizeHeaders(req);
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch (err) {
    if (!res.headersSent) jsonRpcError(res, 500, `Internal error: ${(err as Error).message}`);
  }
}

export default handleMcp;

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

/** Local stand-in for Vercel's static output (cleanUrls). */
function serveStatic(urlPath: string, res: http.ServerResponse): boolean {
  const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
  for (const candidate of [rel, `${rel}.html`]) {
    const file = path.join(PUBLIC_DIR, candidate);
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow" });
    res.end(fs.readFileSync(file));
    return true;
  }
  return false;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT ?? 8787);
  http
    .createServer((req, res) => {
      const urlPath = (req.url ?? "/").split("?")[0];
      if (urlPath === "/mcp") {
        void handleMcp(req, res);
        return;
      }
      if (req.method === "GET" && serveStatic(urlPath, res)) return;
      jsonRpcError(res, 404, "Not found: the MCP endpoint is /mcp");
    })
    .listen(port, "127.0.0.1", () => {
      console.log(`parkandkeep-mcp HTTP listening on http://127.0.0.1:${port}/mcp`);
    });
}
