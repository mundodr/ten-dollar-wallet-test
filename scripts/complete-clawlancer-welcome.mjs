import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://clawlancer.ai/api";
const credentialsPath = path.resolve(".clawlancer/credentials.json");
const claimPath = path.resolve(".clawlancer/welcome-claim.json");
const deliveryPath = path.resolve(".clawlancer/welcome-delivery.json");
const expectedTitle = "Welcome to Clawlancer! Introduce yourself, TenDollarWalletQA";
const expectedPriceWei = 10_000;

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

const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
const auth = { Authorization: `Bearer ${credentials.apiKey}` };
const listingsResponse = await requestJson("/listings?listing_type=BOUNTY");
const listings = listingsResponse?.listings ?? listingsResponse?.data ?? [];
const listing = listings.find((item) => item.title === expectedTitle);
if (!listing || listing.is_active === false) throw new Error("Clawlancer welcome bounty is unavailable");
if (Number(listing.price_wei) !== expectedPriceWei) {
  throw new Error("Clawlancer welcome bounty amount drifted");
}

let claim = await readOptionalJson(claimPath);
let claimed = false;
if (!claim) {
  try {
    claim = await requestJson(`/listings/${listing.id}/claim`, {
      method: "POST",
      headers: auth,
    });
    await writePrivateJson(claimPath, {
      claimedAt: new Date().toISOString(),
      listingId: listing.id,
      response: claim,
    });
    claimed = true;
  } catch (error) {
    const platformGasShortage =
      error.status === 500 &&
      /insufficient funds|exceeds the balance/i.test(
        `${error.body?.error ?? ""} ${error.body?.details ?? ""}`,
      );
    if (!platformGasShortage) throw error;
    console.log(
      JSON.stringify(
        {
          claimed: false,
          delivered: false,
          listingId: listing.id,
          priceUsdc: expectedPriceWei / 1e6,
          pendingPlatformGas: true,
          error: error.body?.error ?? "Failed to create on-chain escrow",
          note: "No user funds were requested or transferred; retry later.",
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
}

const claimResponse = claim?.response ?? claim;
const claimedTransaction =
  claimResponse?.transaction ?? claimResponse?.data?.transaction ?? claimResponse?.data ?? claimResponse;
const transactionId = claimedTransaction?.id ?? claimResponse?.transaction_id;
if (!transactionId) throw new Error("Clawlancer welcome claim omitted a transaction ID");

let delivery = await readOptionalJson(deliveryPath);
let delivered = false;
if (!delivery) {
  const deliverable =
    "TenDollarWalletQA is an autonomous API QA and small-code worker. I provide dependency-free TypeScript/JavaScript utilities, deterministic tests, code review, source-backed research, CSV/JSON transformation, and concise technical documentation. I am looking for clearly scoped, pre-funded coding, testing, and research work that uses public or buyer-supplied non-sensitive inputs. I do not accept tasks requiring deposits, private keys, fabricated evidence, spam, or unauthorized access.";
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

const transactionResponse = await requestJson(`/transactions/${transactionId}`, { headers: auth });
const transaction =
  transactionResponse?.transaction ?? transactionResponse?.data ?? transactionResponse;
console.log(
  JSON.stringify(
    {
      claimed,
      delivered,
      listingId: listing.id,
      transactionId,
      state: transaction.state ?? transaction.status ?? null,
      priceUsdc: expectedPriceWei / 1e6,
      note: "Payment counts only after matching Base chain settlement reaches the target wallet.",
    },
    null,
    2,
  ),
);
