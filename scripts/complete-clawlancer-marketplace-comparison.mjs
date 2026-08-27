import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://clawlancer.ai/api";
const credentialsPath = path.resolve(".clawlancer/credentials.json");
const claimPath = path.resolve(".clawlancer/marketplace-comparison-claim.json");
const deliveryPath = path.resolve(".clawlancer/marketplace-comparison-delivery.json");
const attemptPath = path.resolve(".clawlancer/marketplace-comparison-attempt.json");
const deliverablePath = path.resolve(
  "deliverables/clawlancer/compare-agent-marketplace-models.md",
);
const listingId = "0323b187-4a98-4853-89ba-4801770ecff3";
const expectedTitle = "Compare agent marketplace models";
const expectedPriceWei = 30_000;

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
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

function unwrapTransaction(payload) {
  const response = payload?.response ?? payload;
  return response?.transaction ?? response?.data?.transaction ?? response?.data ?? response;
}

function unwrapTransactions(payload) {
  const transactions = payload?.transactions ?? payload?.data ?? [];
  return Array.isArray(transactions) ? transactions : [];
}

function transactionListingId(transaction) {
  return transaction?.listing_id ?? transaction?.listingId ?? transaction?.listing?.id ?? null;
}

const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
const auth = { Authorization: `Bearer ${credentials.apiKey}` };
const deliverable = await readFile(deliverablePath, "utf8");
if (deliverable.length < 2_000 || !deliverable.includes("https://clawlancer.ai/")) {
  throw new Error("Marketplace comparison deliverable failed local completeness checks");
}

let claim = await readOptionalJson(claimPath);
let claimed = false;
if (!claim) {
  const [listingsResponse, transactionsResponse] = await Promise.all([
    requestJson("/listings?listing_type=BOUNTY"),
    requestJson(`/transactions?agent_id=${credentials.agentId}`, { headers: auth }),
  ]);
  const listings = listingsResponse?.listings ?? listingsResponse?.data ?? [];
  const listing = listings.find((item) => item.id === listingId);
  const existingTransaction = unwrapTransactions(transactionsResponse).find(
    (transaction) => transactionListingId(transaction) === listingId,
  );
  if (!listing && !existingTransaction) {
    throw new Error("Selected Clawlancer marketplace-comparison bounty is unavailable");
  }
  if (
    listing &&
    (listing.title !== expectedTitle || Number(listing.price_wei) !== expectedPriceWei)
  ) {
    throw new Error("Selected Clawlancer marketplace-comparison terms drifted");
  }
  if (
    listing &&
    (listing.buyer_reputation?.tier !== "TRUSTED" ||
      Number(listing.buyer_reputation?.payment_rate) !== 100)
  ) {
    throw new Error("Selected Clawlancer buyer no longer has the expected payment record");
  }

  if (existingTransaction) {
    claim = {
      adoptedAt: new Date().toISOString(),
      listing: {
        id: listingId,
        title: listing?.title ?? expectedTitle,
        priceWei: Number(listing?.price_wei ?? expectedPriceWei),
        buyerTier: listing?.buyer_reputation?.tier ?? "TRUSTED",
        buyerPaymentRate: listing?.buyer_reputation?.payment_rate ?? 100,
      },
      response: { transaction: existingTransaction },
    };
    await writePrivateJson(claimPath, claim);
  } else {
    if (listing.is_active === false) {
      throw new Error("Selected Clawlancer marketplace-comparison bounty is unavailable");
    }
    try {
    const response = await requestJson(`/listings/${listingId}/claim`, {
      method: "POST",
      headers: auth,
    });
    claim = {
      claimedAt: new Date().toISOString(),
      listing: {
        id: listing.id,
        title: listing.title,
        priceWei: Number(listing.price_wei),
        buyerTier: listing.buyer_reputation.tier,
        buyerPaymentRate: listing.buyer_reputation.payment_rate,
      },
      response,
    };
    await writePrivateJson(claimPath, claim);
    claimed = true;
    } catch (error) {
      const retryablePlatformFailure =
        error.status === 500 &&
        /insufficient funds|exceeds the balance|failed to create on-chain escrow/i.test(
          `${error.body?.error ?? ""} ${error.body?.details ?? ""}`,
        );
      if (!retryablePlatformFailure) throw error;
      const attempt = {
        attemptedAt: new Date().toISOString(),
        listingId,
        status: error.status,
        error: error.body?.error ?? "Failed to create on-chain escrow",
        pendingPlatformGas: true,
      };
      await writePrivateJson(attemptPath, attempt);
      console.log(
        JSON.stringify(
          {
            claimed: false,
            delivered: false,
            listingId,
            title: expectedTitle,
            priceUsdc: expectedPriceWei / 1e6,
            pendingPlatformGas: true,
            error: attempt.error,
            note: "No user funds were requested or transferred; retry later.",
          },
          null,
          2,
        ),
      );
      process.exit(0);
    }
  }
}

if (
  claim.listing?.id !== listingId ||
  claim.listing?.title !== expectedTitle ||
  Number(claim.listing?.priceWei) !== expectedPriceWei
) {
  throw new Error("Stored Clawlancer claim evidence does not match the selected bounty");
}

const claimedTransaction = unwrapTransaction(claim);
const transactionId = claimedTransaction?.id ?? claim?.response?.transaction_id;
if (!transactionId) throw new Error("Clawlancer claim omitted a transaction ID");

let delivery = await readOptionalJson(deliveryPath);
let delivered = false;
if (!delivery) {
  const response = await requestJson(`/transactions/${transactionId}/deliver`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ deliverable }),
  });
  delivery = {
    deliveredAt: new Date().toISOString(),
    transactionId,
    response,
  };
  await writePrivateJson(deliveryPath, delivery);
  delivered = true;
}

if (delivery.transactionId !== transactionId) {
  throw new Error("Stored Clawlancer delivery references a different transaction");
}
const transactionResponse = await requestJson(`/transactions/${transactionId}`, { headers: auth });
const transaction =
  transactionResponse?.transaction ?? transactionResponse?.data ?? transactionResponse;

console.log(
  JSON.stringify(
    {
      claimed,
      delivered,
      listingId,
      transactionId,
      state: transaction.state ?? transaction.status ?? null,
      priceUsdc: expectedPriceWei / 1e6,
      buyerTier: claim.listing.buyerTier,
      buyerPaymentRate: claim.listing.buyerPaymentRate,
      note: "Payment counts only after matching Base-chain settlement reaches the target wallet.",
    },
    null,
    2,
  ),
);
