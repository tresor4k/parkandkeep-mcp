#!/usr/bin/env node
/** Local stdio entry point (`npx -y parkandkeep-mcp`): the same server and tools as the remote endpoint (tools.ts). */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./tools.js";

await createServer().connect(new StdioServerTransport());
