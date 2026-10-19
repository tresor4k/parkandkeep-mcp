# Park & Keep MCP server

MCP server (local stdio or remote Streamable HTTP, stateless, read-only, no account) answering questions about the
[Park & Keep airport parking index](https://parkandkeep.com/en/data/airport-parking-index): car parks serving European
airports, their services and airport-level price ranges for 3, 7 and 14-day stays.

Endpoint once deployed: `https://parkandkeep-mcp.vercel.app/mcp` (registry name `io.github.tresor4k/parkandkeep-mcp`).

## Local (stdio)

```sh
npx -y parkandkeep-mcp
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "parkandkeep": {
      "command": "npx",
      "args": ["-y", "parkandkeep-mcp"]
    }
  }
}
```

The stdio server registers the same tools as the remote endpoint and reads the index bundled in the package.

## Remote

Streamable HTTP endpoint: `https://parkandkeep-mcp.vercel.app/mcp`.

| Tool | Returns |
|---|---|
| `airport_parking_options` | Car parks of an airport: services (shuttle, valet, covered, 24 h, keys kept, EV charging, online booking), distance, date checked. No price. |
| `airport_price_snapshot` | Min / median / max public price per stay length and currency, only from 3 prices, with the dates read. Never a price per operator. |
| `airport_market_snapshot` | Number of car parks, shares with shuttle / valet / covered parking, median and shortest distance, number with prices. |

Each tool takes `airport` = IATA code or airport name. The only outbound link is the airport page on parkandkeep.com
(`utm_source=mcp`); no affiliate or partner link.

```sh
npm install
npm test            # build + local HTTP smoke test (tools/list and every tool on 3 airports) + stdio smoke test
npm start           # http://127.0.0.1:8787/mcp
```

Data: `src/data/index.json` and `src/data/hubs.json` are written by `../sync.mjs`; do not edit them by hand.
Licences: code MIT ([LICENSE](LICENSE)); data CC BY 4.0, credit Park & Keep.
