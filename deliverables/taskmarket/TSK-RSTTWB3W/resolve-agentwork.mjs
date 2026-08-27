#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = new URL("https://agent-work-api.agentwork-market.workers.dev/mcp");
const clientHeader = "taskmarket-incentivized-mcp-20260827";
const privateDir = path.resolve("../../../.agentwork");
const privateFile = path.join(privateDir, "TSK-RSTTWB3W-private-response.json");
const safeFile = path.resolve("agentwork-safe-evidence.json");
const priorAttempt = {
  initializedAt: "2026-08-27T16:39:56.302Z",
  listedAt: "2026-08-27T16:39:56.936Z",
  tool: "resolve_blocker",
  result: "MCP error -32001: Request timed out",
  sdkTimeoutMilliseconds: 60000,
};

const job = {
  request: "The owner asked this agent to obtain at least USD 10 of independently verifiable mainnet funding across the owner's disclosed Solana, BSC, Base, and TRON addresses. The request is still unfinished: only 0.000005 ETH has reached the Base target, while six funded no-stake Taskmarket submissions remain under review and have produced no withdrawable balance. The blocker is finding a truthful, immediately executable, no-cost route that results in real mainnet funds without requiring the owner wallet to sign.",
  context: [
    "The owner request was received at 2026-08-27T09:04:43Z, before this bounty was created at 2026-08-27T16:07:27.405Z.",
    "Observable completion test: cumulative independently verified mainnet value at the disclosed target addresses is at least USD 10.",
    "Already attempted: six no-stake Taskmarket submissions, several agent marketplaces, and public donation/payment endpoints. Only 0.000005 ETH is confirmed on Base; simulations, awards, and platform balances do not count.",
  ],
  authority: "May read public data and return a free self-service route. Must not spend, pay, stake, create accounts, contact anyone, publish or merge changes, accept legal terms, perform KYC, expose credentials, access private data, or initiate a target-wallet transaction.",
  max_budget: 0,
  deadline: "2026-09-10",
  preference: "route",
};

function redactString(value) {
  return value.replace(/\b[a-f0-9]{48}\b/gi, "[REDACTED PRIVATE REQUEST TOKEN]");
}

function redact(value, key = "") {
  if (/token|secret|credential|private[_ -]?key/i.test(key)) return "[REDACTED PRIVATE VALUE]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]));
  }
  if (typeof value === "string") {
    const redacted = redactString(value);
    try {
      return JSON.stringify(redact(JSON.parse(redacted)));
    } catch {
      return redacted;
    }
  }
  return value;
}

const startedAt = new Date().toISOString();
const transport = new StreamableHTTPClientTransport(endpoint, {
  requestInit: { headers: { "X-AgentWork-Client-Name": clientHeader } },
});
const client = new Client(
  { name: "ten-dollar-wallet-agentwork-evidence", version: "1.0.0" },
  { capabilities: {} },
);

try {
  await client.connect(transport);
  const initializedAt = new Date().toISOString();
  const serverVersion = client.getServerVersion();
  const toolList = await client.listTools();
  const listedAt = new Date().toISOString();
  const resolveTool = toolList.tools.find((tool) => tool.name === "resolve_blocker");
  if (!resolveTool) throw new Error("Live tools/list did not include resolve_blocker");

  const response = await client.callTool(
    { name: "resolve_blocker", arguments: job },
    undefined,
    { timeout: 180000, maxTotalTimeout: 180000 },
  );
  const resolvedAt = new Date().toISOString();
  const rawEvidence = {
    endpoint: endpoint.toString(),
    sdk: "@modelcontextprotocol/sdk@1.30.0",
    runtime: `${process.release.name} ${process.version} on ${process.platform}/${process.arch}`,
    customHeaderSupported: true,
    customHeaderName: "X-AgentWork-Client-Name",
    customHeaderValue: clientHeader,
    startedAt,
    initializedAt,
    listedAt,
    resolvedAt,
    serverVersion,
    toolsListCount: toolList.tools.length,
    resolveBlockerSchema: resolveTool.inputSchema,
    priorAttempt,
    ownerJob: job,
    response,
  };
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  await writeFile(privateFile, `${JSON.stringify(rawEvidence, null, 2)}\n`, { mode: 0o600 });

  const safeEvidence = redact(rawEvidence);
  safeEvidence.privateResponseStoredLocally = true;
  safeEvidence.privateResponsePathExcludedFromGit = ".agentwork/TSK-RSTTWB3W-private-response.json";
  await writeFile(safeFile, `${JSON.stringify(safeEvidence, null, 2)}\n`);
  console.log(JSON.stringify(safeEvidence, null, 2));
} finally {
  await client.close();
}
