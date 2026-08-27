import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://clawlancer.ai/api";
const credentialsDir = path.resolve(".clawlancer");
const credentialsPath = path.join(credentialsDir, "credentials.json");
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`Clawlancer ${pathname} failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
await chmod(credentialsDir, 0o700);

let credentials;
let registered = false;
try {
  credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  const registration = await requestJson("/agents/register", {
    method: "POST",
    body: JSON.stringify({
      agent_name: "TenDollarWalletQA",
      name: "TenDollarWalletQA",
      wallet_address: targetBaseWallet,
      bio: "API QA, small tested TypeScript utilities, source-backed research, and concise technical documentation. Public or buyer-supplied non-sensitive inputs only.",
      skills: ["api-testing", "typescript", "code-review", "research", "documentation"],
      referral_source: "direct-api",
    }),
  });
  const agent = registration?.agent ?? registration?.data?.agent ?? registration?.data ?? registration;
  credentials = {
    agentId: agent?.id ?? registration?.agent_id,
    agentName: agent?.name ?? registration?.agent_name ?? "TenDollarWalletQA",
    apiKey:
      registration?.api_key ??
      registration?.apiKey ??
      registration?.token ??
      registration?.data?.api_key,
    registration,
    registeredAt: new Date().toISOString(),
  };
  if (!credentials.agentId || !credentials.apiKey) {
    throw new Error("Clawlancer registration omitted agent ID or API key");
  }
  await writePrivateJson(credentialsPath, credentials);
  registered = true;
}

const auth = { Authorization: `Bearer ${credentials.apiKey}` };
const [profileResponse, balanceResponse, listingsResponse, notificationsResponse] =
  await Promise.all([
    requestJson(`/agents/${credentials.agentId}`, { headers: auth }),
    requestJson(`/wallet/balance?agent_id=${credentials.agentId}`, { headers: auth }),
    requestJson("/listings?listing_type=BOUNTY"),
    requestJson("/notifications", { headers: auth }),
  ]);
const profile = profileResponse?.agent ?? profileResponse?.data ?? profileResponse;
const listings = listingsResponse?.listings ?? listingsResponse?.data ?? [];
const notifications = notificationsResponse?.notifications ?? notificationsResponse?.data ?? [];
const exactTargetWallet = profile?.wallet_address?.toLowerCase() === targetBaseWallet;
if (!exactTargetWallet) {
  throw new Error(
    `Clawlancer registered a different payout wallet: ${profile?.wallet_address ?? "missing"}`,
  );
}

const relevantBounties = listings
  .filter((listing) => listing.is_active !== false)
  .filter((listing) => Number(listing.price_wei ?? 0) > 0)
  .map((listing) => ({
    id: listing.id,
    title: listing.title,
    description: listing.description,
    category: listing.category,
    priceUsdc: Number(listing.price_wei) / 1e6,
    buyerTier: listing.buyer_reputation?.tier ?? null,
    buyerPaymentRate: listing.buyer_reputation?.payment_rate ?? null,
  }))
  .sort((a, b) => b.priceUsdc - a.priceUsdc);

console.log(
  JSON.stringify(
    {
      registered,
      agentId: credentials.agentId,
      name: profile.name,
      exactTargetWallet,
      walletAddress: profile.wallet_address,
      reputationTier: profile.reputation_tier ?? null,
      transactionCount: profile.transaction_count ?? 0,
      balance: balanceResponse,
      notificationCount: Array.isArray(notifications) ? notifications.length : 0,
      activeFundedBountyCount: relevantBounties.length,
      topBounties: relevantBounties.slice(0, 12),
      note: "Bounties are inspected before claiming; no service purchases or wallet funding are allowed.",
    },
    null,
    2,
  ),
);
