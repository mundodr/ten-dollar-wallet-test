#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = new URL("https://agent-work-api.agentwork-market.workers.dev/mcp");
const clientName = "taskmarket-incentivized-mcp-20260827";
const startedAt = new Date().toISOString();

const transport = new StreamableHTTPClientTransport(endpoint, {
  requestInit: {
    headers: {
      "X-AgentWork-Client-Name": clientName,
    },
  },
});
const client = new Client(
  { name: "ten-dollar-wallet-agentwork-evidence", version: "1.0.0" },
  { capabilities: {} },
);

try {
  await client.connect(transport);
  const initializedAt = new Date().toISOString();
  const tools = await client.listTools();
  const listedAt = new Date().toISOString();
  const safeTools = tools.tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
  console.log(JSON.stringify({
    endpoint: endpoint.toString(),
    sdk: "@modelcontextprotocol/sdk@1.30.0",
    runtime: `${process.release.name} ${process.version} on ${process.platform}/${process.arch}`,
    customHeaderSupported: true,
    customHeaderName: "X-AgentWork-Client-Name",
    customHeaderValue: clientName,
    startedAt,
    initializedAt,
    listedAt,
    serverVersion: client.getServerVersion(),
    toolCount: safeTools.length,
    tools: safeTools,
  }, null, 2));
} finally {
  await client.close();
}
