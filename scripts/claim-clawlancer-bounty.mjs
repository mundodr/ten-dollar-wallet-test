import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://clawlancer.ai/api";
const credentialsPath = path.resolve(".clawlancer/credentials.json");
const claimPath = path.resolve(".clawlancer/claim.json");
const attemptPath = path.resolve(".clawlancer/claim-attempt.json");
const listingId = "a4444860-42b4-4ff3-9161-37f8a06f4b30";
const expectedTitle = "Build a simple API rate limiter";
const expectedPriceWei = 30_000;

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

const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
const auth = { Authorization: `Bearer ${credentials.apiKey}` };
const listingsResponse = await requestJson("/listings?listing_type=BOUNTY");
const listings = listingsResponse?.listings ?? listingsResponse?.data ?? [];
const listing = listings.find((item) => item.id === listingId);
if (!listing || listing.is_active === false) throw new Error("Selected Clawlancer bounty is unavailable");
if (listing.title !== expectedTitle || Number(listing.price_wei) !== expectedPriceWei) {
  throw new Error("Selected Clawlancer bounty terms drifted");
}
if (
  listing.buyer_reputation?.tier !== "TRUSTED" ||
  Number(listing.buyer_reputation?.payment_rate) !== 100
) {
  throw new Error("Selected Clawlancer buyer no longer has the expected payment record");
}

let claim;
let claimed = false;
try {
  claim = JSON.parse(await readFile(claimPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  try {
    claim = await requestJson(`/listings/${listingId}/claim`, {
      method: "POST",
      headers: auth,
    });
  } catch (claimError) {
    const platformGasShortage =
      claimError.status === 500 &&
      /insufficient funds|exceeds the balance/i.test(
        `${claimError.body?.error ?? ""} ${claimError.body?.details ?? ""}`,
      );
    if (!platformGasShortage) throw claimError;
    const attempt = {
      attemptedAt: new Date().toISOString(),
      listingId,
      status: claimError.status,
      error: claimError.body?.error ?? "Failed to create on-chain escrow",
      pendingPlatformGas: true,
    };
    await writePrivateJson(attemptPath, attempt);
    console.log(
      JSON.stringify(
        {
          claimed: false,
          listingId,
          title: listing.title,
          priceUsdc: Number(listing.price_wei) / 1e6,
          pendingPlatformGas: true,
          error: attempt.error,
          note:
            "The platform's escrow sender lacks gas. No user funds were requested or transferred; retry later.",
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  claim.claimedAt = new Date().toISOString();
  await writePrivateJson(claimPath, claim);
  claimed = true;
}

const transaction = claim?.transaction ?? claim?.data?.transaction ?? claim?.data ?? claim;
const transactionId = transaction?.id ?? claim?.transaction_id;
if (!transactionId) throw new Error("Clawlancer claim omitted a transaction ID");

console.log(
  JSON.stringify(
    {
      claimed,
      listingId,
      title: listing.title,
      priceUsdc: Number(listing.price_wei) / 1e6,
      buyerTier: listing.buyer_reputation.tier,
      buyerPaymentRate: listing.buyer_reputation.payment_rate,
      transactionId,
      status: transaction.status ?? null,
      note: "The bounty is pre-funded; delivery is submitted only after original code and tests pass.",
    },
    null,
    2,
  ),
);
