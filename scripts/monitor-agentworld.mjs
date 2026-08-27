import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://agentworld.me/api/agentworld";
const targetWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const treasuryWallet = "0x367f1b3d8ca90d1e087481a9a40d585bf3451a03";
const registrationTransferHash =
  "0xa13807c967e0dcc7e70fcedfb7a443f324004405b32c60876587f9cdbec27a12";
const credentials = JSON.parse(
  await readFile(path.resolve(".agentworld/credentials.json"), "utf8"),
);
const digitalStoreStatePath = path.resolve(".agentworld/digital-store-product.json");

async function readOptionalJson(file) {
  try {
    await access(file, constants.F_OK);
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function fetchJson(endpoint) {
  const url = endpoint.startsWith("https://") ? endpoint : `${baseUrl}${endpoint}`;
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(25_000),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) return body;
      lastError = new Error(`AgentWorld returned HTTP ${response.status} for ${endpoint}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError ?? new Error("AgentWorld returned no response");
}

const digitalStoreState = await readOptionalJson(digitalStoreStatePath);
const [status, externalProfile, jobsResponse, transactionResponse, productsResponse] = await Promise.all([
  fetchJson(`/agent/status/${encodeURIComponent(credentials.agentId)}`),
  fetchJson(`/registry/${encodeURIComponent(credentials.externalAgentId)}`),
  fetchJson("/jobs"),
  fetchJson(`https://base.blockscout.com/api/v2/addresses/${targetWallet}/transactions`),
  fetchJson("/digital-store/products"),
]);
const agent = status?.agent ?? status;
const externalAgent = externalProfile?.agent ?? externalProfile;
const jobs = Array.isArray(jobsResponse) ? jobsResponse : jobsResponse?.jobs ?? [];
const wallet = agent?.wallet ?? credentials.wallet ?? null;
const exactWallet = wallet?.toLowerCase() === targetWallet;
const externalWallet = externalAgent?.owner_wallet ?? null;
const exactExternalWallet = externalWallet?.toLowerCase() === targetWallet;
const openJobs = jobs.filter((job) => job.status === "open");
const transactions = transactionResponse?.items ?? [];
const products = productsResponse?.products ?? [];
const digitalStoreProduct = digitalStoreState
  ? products.find((product) => product.id === digitalStoreState.productId) ?? null
  : null;
const registrationTransfer = transactions.find(
  (transaction) =>
    transaction.hash?.toLowerCase() === registrationTransferHash &&
    transaction.status === "ok" &&
    transaction.from?.hash?.toLowerCase() === treasuryWallet &&
    transaction.to?.hash?.toLowerCase() === targetWallet &&
    transaction.value === "5000000000000",
);

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agentId: credentials.agentId,
      name: credentials.name,
      status: agent?.status ?? null,
      wallet,
      exactWallet,
      externalAgentId: credentials.externalAgentId,
      externalName: credentials.externalName,
      externalStatus: externalAgent?.status ?? null,
      externalWallet,
      exactExternalWallet,
      externalCalls: externalAgent?.call_count ?? null,
      externalEarningsUsdc: externalAgent?.earnings_usdc ?? null,
      inWorldUsdcBalance: agent?.usdc_balance ?? agent?.balance_usdc ?? null,
      pendingPayout: agent?.pending_payout ?? agent?.pending_usdc ?? null,
      paidUsdc: agent?.paid_usdc ?? agent?.total_paid_usdc ?? null,
      payoutTxHash: agent?.payout_tx_hash ?? agent?.last_payout_tx_hash ?? null,
      digitalStoreProduct: digitalStoreState
        ? {
            id: digitalStoreProduct?.id ?? digitalStoreState.productId,
            found: Boolean(digitalStoreProduct),
            title: digitalStoreProduct?.title ?? null,
            status: digitalStoreProduct?.status ?? null,
            verified: digitalStoreProduct?.verified ?? null,
            priceUsdc: digitalStoreProduct?.price_usdc ?? null,
            sellerIdMatches:
              digitalStoreProduct?.seller_id === credentials.agentId,
            purchases: digitalStoreProduct?.purchases ?? null,
            revenueUsdc: digitalStoreProduct?.revenue_usdc ?? null,
            sellerPayoutUsdc: digitalStoreProduct?.seller_payout_usdc ?? null,
            expectedSellerAmountPerPurchaseUsdc:
              digitalStoreState.expectedSellerAmountPerPurchaseUsdc ?? null,
            fileUrl: digitalStoreProduct?.file_url ?? null,
          }
        : null,
      verifiedRegistrationTransfer: registrationTransfer
        ? {
            hash: registrationTransfer.hash,
            blockNumber: registrationTransfer.block_number,
            valueWei: registrationTransfer.value,
            valueEth: Number(registrationTransfer.value) / 1e18,
            from: registrationTransfer.from?.hash ?? null,
            to: registrationTransfer.to?.hash ?? null,
            timestamp: registrationTransfer.timestamp,
            status: registrationTransfer.status,
          }
        : null,
      openJobCount: openJobs.length,
      openJobs: openJobs.map((job) => ({
        id: job.id,
        title: job.title,
        description: job.description,
        category: job.category ?? null,
        rewardUsdc: job.reward_usdc,
        requiredSkills: job.required_skills ?? [],
        expiresAt: job.expires_at,
      })),
    },
    null,
    2,
  ),
);

if (
  !exactWallet ||
  !exactExternalWallet ||
  !registrationTransfer ||
  (digitalStoreState &&
    (!digitalStoreProduct || digitalStoreProduct.seller_id !== credentials.agentId))
) {
  throw new Error(
    "AgentWorld profiles or the expected registration transfer no longer verify",
  );
}
