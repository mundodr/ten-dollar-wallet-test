import { readFile } from "node:fs/promises";
import path from "node:path";

const siteBase = "https://payapi.market";
const projectCredentialsPath = path.resolve(".frantic/credentials.json");
const statePath = path.resolve(".payapimarket/state.json");
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";

function findProjectEmail(value) {
  if (!value || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value)) {
    if (/email/i.test(key) && typeof item === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item)) {
      return item.toLowerCase();
    }
    const nested = findProjectEmail(item);
    if (nested) return nested;
  }
  return null;
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${siteBase}${pathname}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`PayAPI Market ${pathname} failed (${response.status})`);
  return body;
}

const [projectCredentials, state] = await Promise.all([
  readFile(projectCredentialsPath, "utf8").then(JSON.parse),
  readFile(statePath, "utf8").then(JSON.parse),
]);
const projectEmail = findProjectEmail(projectCredentials);
if (!projectEmail) throw new Error("The verified project mailbox was not found");

const login = await requestJson("/api/provider-login", {
  method: "POST",
  body: JSON.stringify({ email: projectEmail }),
});
const dashboard = await requestJson("/api/get-provider", {
  method: "POST",
  headers: { Authorization: `Bearer ${login.token}` },
  body: JSON.stringify({ email: projectEmail }),
});
const provider = dashboard.provider;
const listing = dashboard.listings?.find((item) => item.id === state.listingId);
const exactBaseWallet = provider?.wallet_address?.toLowerCase() === targetBaseWallet;
if (!listing || !exactBaseWallet || listing.base_url !== state.baseUrl) {
  throw new Error("PayAPI Market listing or payout wallet drifted");
}

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      providerId: provider.id,
      listingId: listing.id,
      listingName: listing.name,
      exactBaseWallet,
      tier: provider.tier,
      providerStatus: provider.status,
      listingStatus: listing.status,
      healthStatus: listing.health_status ?? null,
      paymentVerified: listing.payment_verified ?? false,
      paymentVerifiedAt: listing.payment_verified_at ?? null,
      verificationTxHash: listing.verification_tx_hash ?? null,
      totalCalls: listing.total_calls ?? 0,
      totalRevenueUsdc: listing.total_revenue_usdc ?? 0,
      note:
        "Only the operator's real verification payment or third-party calls visible on the target Base chain count toward the goal.",
    },
    null,
    2,
  ),
);
