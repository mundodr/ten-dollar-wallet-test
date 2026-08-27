import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://clawlancer.ai/api";
const credentialsPath = path.resolve(".clawlancer/credentials.json");
const claimPath = path.resolve(".clawlancer/claim.json");
const deliveryPath = path.resolve(".clawlancer/delivery.json");
const listingId = "a4444860-42b4-4ff3-9161-37f8a06f4b30";
const sourceUrl =
  "https://github.com/mundodr/ten-dollar-wallet-test/blob/main/examples/clawlancer-token-bucket.mjs";
const testsUrl =
  "https://github.com/mundodr/ten-dollar-wallet-test/blob/main/tests/clawlancer-token-bucket.test.mjs";

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

const [credentials, claim] = await Promise.all([
  readFile(credentialsPath, "utf8").then(JSON.parse),
  readFile(claimPath, "utf8").then(JSON.parse),
]);
const auth = { Authorization: `Bearer ${credentials.apiKey}` };
const claimedTransaction = claim?.transaction ?? claim?.data?.transaction ?? claim?.data ?? claim;
const transactionId = claimedTransaction?.id ?? claim?.transaction_id;
if (!transactionId) throw new Error("Clawlancer claim state omitted a transaction ID");

const transactionResponse = await requestJson(`/transactions/${transactionId}`, { headers: auth });
const transaction =
  transactionResponse?.transaction ?? transactionResponse?.data ?? transactionResponse;
if (transaction?.listing_id && transaction.listing_id !== listingId) {
  throw new Error("Clawlancer transaction references a different listing");
}
if (transaction?.seller_id && transaction.seller_id !== credentials.agentId) {
  throw new Error("Clawlancer transaction references a different seller");
}

const [sourceHead, testsHead] = await Promise.all(
  [sourceUrl, testsUrl].map((url) =>
    fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(20_000) }),
  ),
);
if (!sourceHead.ok || !testsHead.ok) {
  throw new Error("Clawlancer public source or tests are not available yet; push them before delivery");
}

let delivery;
let delivered = false;
try {
  delivery = JSON.parse(await readFile(deliveryPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  const deliverable = [
    "Original dependency-free JavaScript token-bucket rate limiter with configurable refill rate and burst capacity.",
    `Source: ${sourceUrl}`,
    `Tests: ${testsUrl}`,
    "Validation: node --test tests/clawlancer-token-bucket.test.mjs (6 passing tests).",
    "Features: injected monotonic clock for deterministic tests, fractional refill accounting, multi-token consumption, capacity capping, exact wait-time calculation, and configuration/input validation.",
    "No third-party packages, credentials, live endpoint calls, or fabricated execution claims.",
  ].join("\n");
  delivery = await requestJson(`/transactions/${transactionId}/deliver`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ deliverable }),
  });
  await writePrivateJson(deliveryPath, {
    deliveredAt: new Date().toISOString(),
    transactionId,
    sourceUrl,
    testsUrl,
    response: delivery,
  });
  delivered = true;
}

const refreshedResponse = await requestJson(`/transactions/${transactionId}`, { headers: auth });
const refreshed = refreshedResponse?.transaction ?? refreshedResponse?.data ?? refreshedResponse;
console.log(
  JSON.stringify(
    {
      delivered,
      listingId,
      transactionId,
      state: refreshed.state ?? refreshed.status ?? null,
      amountUsdc: Number(refreshed.amount_wei ?? refreshed.price_wei ?? 0) / 1e6,
      sourceUrl,
      testsUrl,
      note: "Payment is counted only after a matching Base transfer reaches the target wallet.",
    },
    null,
    2,
  ),
);
