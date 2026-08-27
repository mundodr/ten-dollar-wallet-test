import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://agentictrade.io";
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const credentials = JSON.parse(
  await readFile(path.resolve(".agentictrade/credentials.json"), "utf8"),
);
const state = JSON.parse(
  await readFile(path.resolve(".agentictrade/external-service-state.json"), "utf8"),
);
const token = credentials.walletProviderToken;

if (!token) throw new Error("Wallet-bound AgenticTrade provider token is unavailable");

async function api(route) {
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(new URL(route, baseUrl), {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  if (!response) throw lastError ?? new Error(`No AgenticTrade response from ${route}`);
  const body = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body };
}

const [dashboard, earnings, onboarding, keys, service] = await Promise.all([
  api("/api/v1/provider/dashboard"),
  api("/api/v1/provider/earnings"),
  api("/api/v1/provider/onboarding"),
  api("/api/v1/provider/keys"),
  api(`/api/v1/services/${encodeURIComponent(state.serviceId)}`),
]);

let publicHealth = { ok: false, status: null };
for (let attempt = 1; attempt <= 3 && !publicHealth.ok; attempt += 1) {
  try {
    const response = await fetch(new URL("/health", state.endpoint), {
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => null);
    publicHealth = { ok: response.ok && body?.status === "ok", status: response.status };
  } catch {
    // A failed tunnel is reported explicitly so the next goal run can replace it.
  }
}

const walletKey = (keys.body?.keys ?? []).find(
  (key) => key.key_id === credentials.walletProviderKeyId,
);
const payoutWalletMatches =
  walletKey?.wallet_address?.toLowerCase() === targetBaseWallet.toLowerCase();

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      service: {
        id: state.serviceId,
        status: service.body?.status,
        pricePerCall:
          service.body?.pricing?.price_per_call ?? service.body?.price_per_call ?? null,
        publicHealth,
      },
      provider: {
        dashboard: dashboard.body,
        earnings: earnings.body,
        onboarding: onboarding.body,
      },
      payout: {
        network: "Base",
        wallet: targetBaseWallet,
        walletKeyConfigured: payoutWalletMatches,
      },
      allApiChecksSucceeded: [dashboard, earnings, onboarding, keys, service].every(
        (result) => result.ok,
      ),
    },
    null,
    2,
  ),
);

if (!payoutWalletMatches) throw new Error("AgenticTrade Base payout wallet no longer matches");
