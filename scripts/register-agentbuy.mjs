import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Use the canonical host directly so a redirect cannot strip Authorization.
const sellerMcpUrl = "https://www.agentbuy.shop/api/mcp/seller";
const credentialsDir = path.resolve(".agentbuy");
const credentialsPath = path.join(credentialsDir, "credentials.json");
const statePath = path.join(credentialsDir, "state.json");
const targetSolanaWallet = "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt";

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

function parseToolResult(response, toolName) {
  if (response?.error) {
    throw new Error(`AgentBuy ${toolName} failed: ${JSON.stringify(response.error)}`);
  }
  const content = response?.result?.content;
  if (!Array.isArray(content)) throw new Error(`AgentBuy ${toolName} omitted MCP content`);
  const text = content.find((item) => item?.type === "text")?.text;
  if (!text) throw new Error(`AgentBuy ${toolName} omitted text content`);
  const parsed = JSON.parse(text);
  if (parsed?.success === false) {
    throw new Error(`AgentBuy ${toolName} rejected the request: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function callTool(name, args = {}, apiKey) {
  const response = await fetch(sellerMcpUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${name}-${Date.now()}`,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    redirect: "follow",
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

await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
await chmod(credentialsDir, 0o700);

let credentials;
let registered = false;
try {
  credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  const registration = await callTool("register_seller_account", {
    display_name: "Ten Dollar Wallet QA",
  });
  credentials = {
    agentSellerId: registration.agent_seller_id,
    repositoryId: registration.repository_id,
    apiKey: registration.api_key,
    claimUrl: registration.claim_url,
    registeredAt: new Date().toISOString(),
  };
  if (!credentials.agentSellerId || !credentials.repositoryId || !credentials.apiKey) {
    throw new Error("AgentBuy registration omitted seller ID, repository ID, or API key");
  }
  await writePrivateJson(credentialsPath, credentials);
  registered = true;
}

const walletResult = await callTool(
  "set_payout_wallet",
  { wallet_address: targetSolanaWallet },
  credentials.apiKey,
);
const [profile, stats, sales, licenses, assets] = await Promise.all([
  callTool("get_seller_profile", {}, credentials.apiKey),
  callTool("get_seller_stats", {}, credentials.apiKey),
  callTool("get_seller_sales", {}, credentials.apiKey),
  callTool("list_licenses", {}, credentials.apiKey),
  callTool("list_assets", {}, credentials.apiKey),
]);
const exactSolanaPayoutWallet =
  containsExactString(walletResult, targetSolanaWallet) ||
  containsExactString(profile, targetSolanaWallet);

const state = {
  checkedAt: new Date().toISOString(),
  registered,
  agentSellerId: credentials.agentSellerId,
  repositoryId: credentials.repositoryId,
  payoutWallet: exactSolanaPayoutWallet ? targetSolanaWallet : null,
  walletVerified:
    profile.wallet_verified ?? profile.payout_wallet_verified ?? walletResult.wallet_verified ?? false,
  plan: profile.plan ?? profile.subscription?.plan ?? null,
  stats,
  sales,
  licenses,
  assets,
};
await writePrivateJson(statePath, state);

if (!exactSolanaPayoutWallet) {
  throw new Error(`AgentBuy payout wallet mismatch: ${state.payoutWallet ?? "missing"}`);
}

console.log(
  JSON.stringify(
    {
      registered,
      agentSellerId: state.agentSellerId,
      repositoryId: state.repositoryId,
      exactSolanaPayoutWallet,
      walletVerified: state.walletVerified,
      plan: state.plan,
      sales: stats.total_sales ?? sales.total ?? 0,
      earningsUsd: stats.total_earnings_usd ?? stats.earnings_usd ?? 0,
      licenseCount: licenses.licenses?.length ?? 0,
      assetCount: assets.assets?.length ?? 0,
      note:
        "The account is real, but paid publication must not proceed if AgentBuy requires a signature from the target Solana wallet.",
    },
    null,
    2,
  ),
);
