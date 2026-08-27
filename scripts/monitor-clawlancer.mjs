import { readFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://clawlancer.ai/api";
const credentialsPath = path.resolve(".clawlancer/credentials.json");
const claimPath = path.resolve(".clawlancer/marketplace-comparison-claim.json");
const attemptPath = path.resolve(".clawlancer/marketplace-comparison-attempt.json");
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const selectedListingId = "0323b187-4a98-4853-89ba-4801770ecff3";

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Clawlancer ${pathname} failed (${response.status})`);
  return body;
}

async function requestOptionalJson(pathname, options = {}) {
  try {
    return { ok: true, body: await requestJson(pathname, options), status: 200 };
  } catch (error) {
    const match = error.message.match(/\((\d{3})\)$/);
    return { ok: false, body: null, status: match ? Number(match[1]) : null };
  }
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
const auth = { Authorization: `Bearer ${credentials.apiKey}` };
const [
  profileResponse,
  balanceResponse,
  listingsResponse,
  transactionsResponse,
  notificationsResponse,
  claim,
  attempt,
] = await Promise.all([
  requestJson(`/agents/${credentials.agentId}`, { headers: auth }),
  requestJson(`/wallet/balance?agent_id=${credentials.agentId}`, { headers: auth }),
  requestJson("/listings?listing_type=BOUNTY"),
  requestOptionalJson(`/transactions?agent_id=${credentials.agentId}`, { headers: auth }),
  requestOptionalJson("/notifications", { headers: auth }),
  readOptionalJson(claimPath),
  readOptionalJson(attemptPath),
]);

const profile = profileResponse?.agent ?? profileResponse?.data ?? profileResponse;
const listings = listingsResponse?.listings ?? listingsResponse?.data ?? [];
const transactions =
  transactionsResponse.body?.transactions ?? transactionsResponse.body?.data ?? [];
const notifications =
  notificationsResponse.body?.notifications ?? notificationsResponse.body?.data ?? [];
const exactTargetWallet = profile?.wallet_address?.toLowerCase() === targetBaseWallet;
if (!exactTargetWallet || balanceResponse?.wallet_address?.toLowerCase() !== targetBaseWallet) {
  throw new Error("Clawlancer profile or wallet balance target drifted");
}

const selected = listings.find((listing) => listing.id === selectedListingId);
const fundedBounties = listings.filter(
  (listing) => listing.is_active !== false && Number(listing.price_wei ?? 0) > 0,
);
const transaction = claim?.transaction ?? claim?.data?.transaction ?? claim?.data ?? claim;

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agentId: credentials.agentId,
      name: profile.name,
      exactTargetWallet,
      targetWallet: profile.wallet_address,
      reputationTier: profile.reputation_tier ?? null,
      transactionCount: profile.transaction_count ?? 0,
      walletBalance: {
        usdc: balanceResponse.balance_usdc ?? "0",
        eth: balanceResponse.eth_balance ?? "0",
      },
      platformTransactionCount: Array.isArray(transactions) ? transactions.length : 0,
      transactionsEndpointStatus: transactionsResponse.status,
      notificationCount: Array.isArray(notifications) ? notifications.length : 0,
      notificationsEndpointStatus: notificationsResponse.status,
      activeFundedBountyCount: fundedBounties.length,
      selectedBounty: selected
        ? {
            id: selected.id,
            title: selected.title,
            priceUsdc: Number(selected.price_wei) / 1e6,
            active: selected.is_active !== false,
            buyerTier: selected.buyer_reputation?.tier ?? null,
            buyerPaymentRate: selected.buyer_reputation?.payment_rate ?? null,
          }
        : null,
      claim: claim
        ? {
            transactionId: transaction?.id ?? claim?.transaction_id ?? null,
            status: transaction?.status ?? null,
          }
        : null,
      latestClaimAttempt: attempt,
      note:
        "Failed escrow creation is a platform gas issue. No target-chain credit is counted without a matching transfer.",
    },
    null,
    2,
  ),
);
