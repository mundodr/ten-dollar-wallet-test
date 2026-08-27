import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://agentpaystore.com";
const listingId = "f9bd95ef-11c0-49ff-be57-3db86f3499cb";
const targetAddress = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const credentials = JSON.parse(
  await readFile(path.resolve(".agentpaystore/credentials.json"), "utf8"),
);

async function fetchJson(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) return body;
      lastError = new Error(`AgentPay Store returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError ?? new Error("AgentPay Store returned no response");
}

const [catalog, status, endpointHealth] = await Promise.all([
  fetchJson(`${baseUrl}/custom/api/listings`),
  fetchJson(credentials.manage_url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${credentials.api_key}`,
    },
  }),
  fetchJson(credentials.endpointUrl, { headers: { Accept: "application/json" } }),
]);
const listing = (catalog?.listings ?? []).find(
  (candidate) => candidate.id === listingId,
);
const exactListing =
  listing?.endpoint_url === credentials.endpointUrl &&
  listing?.name === "API Brief Acceptance Checklist" &&
  Number(listing?.price_per_call) === 0.01 &&
  credentials.paymentAddress?.toLowerCase() === targetAddress;

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      listingId,
      publicUrl: `${baseUrl}/custom`,
      listed: Boolean(listing),
      exactListing,
      status: status?.status ?? listing?.status ?? null,
      pingStatus: status?.ping_status ?? null,
      lastPing: status?.last_ping ?? null,
      endpointHealth: endpointHealth?.service ?? endpointHealth?.status ?? "ok",
      pricePerCall: listing?.price_per_call ?? null,
      revenueShare: credentials.revenue_split ?? null,
      totalCalls: status?.total_calls ?? listing?.total_calls ?? null,
      totalRevenueUsdc: status?.total_revenue_usdc ?? null,
      targetAddressMatches: credentials.paymentAddress?.toLowerCase() === targetAddress,
    },
    null,
    2,
  ),
);

if (!exactListing) {
  throw new Error("AgentPay Store listing no longer matches the intended service");
}
