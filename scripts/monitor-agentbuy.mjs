import { readFile } from "node:fs/promises";
import path from "node:path";

const sellerMcpUrl = "https://www.agentbuy.shop/api/mcp/seller";
const credentialsPath = path.resolve(".agentbuy/credentials.json");
const targetSolanaWallet = "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt";

function parseToolResult(response, toolName) {
  if (response?.error) throw new Error(`AgentBuy ${toolName} failed`);
  const text = response?.result?.content?.find((item) => item?.type === "text")?.text;
  if (!text) throw new Error(`AgentBuy ${toolName} omitted content`);
  const parsed = JSON.parse(text);
  if (parsed?.success === false) throw new Error(`AgentBuy ${toolName} rejected the request`);
  return parsed;
}

async function callTool(name, apiKey) {
  const response = await fetch(sellerMcpUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${name}-${Date.now()}`,
      method: "tools/call",
      params: { name, arguments: {} },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`AgentBuy ${name} HTTP ${response.status}`);
  return parseToolResult(body, name);
}

function containsExactString(value, expected) {
  if (typeof value === "string") return value === expected;
  if (Array.isArray(value)) return value.some((item) => containsExactString(item, expected));
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => containsExactString(item, expected));
  }
  return false;
}

function findBooleanByKey(value, keyPattern) {
  if (!value || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value)) {
    if (keyPattern.test(key) && typeof item === "boolean") return item;
    const nested = findBooleanByKey(item, keyPattern);
    if (nested !== null) return nested;
  }
  return null;
}

const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
const [profile, stats, sales, licenses, assets] = await Promise.all([
  callTool("get_seller_profile", credentials.apiKey),
  callTool("get_seller_stats", credentials.apiKey),
  callTool("get_seller_sales", credentials.apiKey),
  callTool("list_licenses", credentials.apiKey),
  callTool("list_assets", credentials.apiKey),
]);
const exactSolanaPayoutWallet = containsExactString(profile, targetSolanaWallet);
if (!exactSolanaPayoutWallet) throw new Error("AgentBuy payout wallet drifted");

const salesSummary = sales.summary ?? stats.sales ?? {};
console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agentSellerId: credentials.agentSellerId,
      repositoryId: credentials.repositoryId,
      exactSolanaPayoutWallet,
      walletVerified: findBooleanByKey(profile, /wallet.*verified|verified.*wallet/i) ?? false,
      plan: profile.plan ?? profile.subscription?.plan ?? null,
      assetCount: assets.total ?? assets.assets?.length ?? 0,
      licenseCount: licenses.licenses?.length ?? 0,
      searchImpressions: stats.search_impressions ?? 0,
      previewDownloads: stats.preview_downloads ?? 0,
      totalSales: salesSummary.totalSales ?? salesSummary.total ?? 0,
      grossUsdc: salesSummary.grossUsdc ?? 0,
      earningsUsdc: salesSummary.earningsUsdc ?? 0,
      pendingPayoutUsdc: salesSummary.pendingPayoutUsdc ?? 0,
      note:
        "AgentBuy counters are secondary evidence. No sale or payout is counted without matching Solana chain evidence.",
    },
    null,
    2,
  ),
);
