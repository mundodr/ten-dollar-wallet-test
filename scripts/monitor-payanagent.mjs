import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://payanagent.com";
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const catalogTaskId = "ks76vc9pzpz3qfgf8aawjckn5n8bezhf";
const catalogBidId = "jd7afj07er0yhgbxm5wcj9e1vd8d9ey7";
const credentials = JSON.parse(
  await readFile(path.resolve(".payanagent/credentials.json"), "utf8"),
);
const state = JSON.parse(
  await readFile(path.resolve(".payanagent/service-state.json"), "utf8"),
);

async function json(route, options = {}) {
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(new URL(route, baseUrl), {
        ...options,
        headers: { Accept: "application/json", ...options.headers },
      });
      if (response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  if (!response) throw lastError ?? new Error(`No PayanAgent response from ${route}`);
  return { response, body: await response.json().catch(() => null) };
}

const [profile, offer, receipts, catalogTask] = await Promise.all([
  json(`/api/v1/agents/${encodeURIComponent(credentials.agentId)}`),
  json(`/api/v1/offers/${encodeURIComponent(state.offerId)}`),
  json(`/api/v1/agents/${encodeURIComponent(credentials.agentId)}/receipts?side=seller&limit=100`),
  json(`/api/v1/requests/${encodeURIComponent(catalogTaskId)}`),
]);

const challengeResponse = await fetch(
  new URL(`/x402/${encodeURIComponent(state.offerId)}`, baseUrl),
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: "GET /health must return JSON status 200." }),
  },
);
const challengeHeader = challengeResponse.headers.get("payment-required");
let challenge = null;
try {
  challenge = JSON.parse(Buffer.from(challengeHeader ?? "", "base64").toString("utf8"));
} catch {
  // A malformed or missing challenge is reported through the checks below.
}
const payment = challenge?.accepts?.[0];
const challengeMatches =
  challengeResponse.status === 402 &&
  payment?.network === "eip155:8453" &&
  payment?.asset?.toLowerCase() === baseUsdc.toLowerCase() &&
  payment?.payTo?.toLowerCase() === targetBaseWallet.toLowerCase() &&
  payment?.amount === "10000";

let endpointHealth = { ok: false, status: null };
for (let attempt = 1; attempt <= 3 && !endpointHealth.ok; attempt += 1) {
  try {
    const response = await fetch(new URL("/health", state.endpoint), {
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => null);
    endpointHealth = { ok: response.ok && body?.status === "ok", status: response.status };
  } catch {
    // A failed tunnel is reported so the next goal run can replace it.
  }
}

const profileWallet = profile.body?.walletAddress ?? profile.body?.wallet_address;
const profileWalletMatches =
  profileWallet?.toLowerCase() === targetBaseWallet.toLowerCase();
const offerBody = offer.body?.offer ?? offer.body;
const catalogBid = (catalogTask.body?.bids ?? []).find((bid) => bid._id === catalogBidId);

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agent: {
        id: credentials.agentId,
        status: profile.body?.status,
        walletMatches: profileWalletMatches,
        totalEarned: profile.body?.totalEarned ?? 0,
        completed: profile.body?.totalJobsCompleted ?? 0,
      },
      offer: {
        id: state.offerId,
        title: offerBody?.title,
        active: offerBody?.isActive ?? offerBody?.status === "active",
        priceUsd: offerBody?.priceUsd,
        endpointHealth,
      },
      x402: {
        unpaidProbeStatus: challengeResponse.status,
        network: payment?.network,
        asset: payment?.asset,
        amountBaseUnits: payment?.amount,
        payTo: payment?.payTo,
        exactTargetTerms: challengeMatches,
      },
      receipts: receipts.body,
      catalogTaskBid: {
        requestId: catalogTaskId,
        requestStatus: catalogTask.body?.request?.status,
        escrowDepositedCents: catalogTask.body?.request?.escrowDepositedCents,
        bidId: catalogBidId,
        bidStatus: catalogBid?.status ?? "not_found",
        bidPriceCents: catalogBid?.priceCents ?? null,
      },
      allChecksSucceeded:
        profile.response.ok &&
        offer.response.ok &&
        receipts.response.ok &&
        catalogTask.response.ok &&
        profileWalletMatches &&
        challengeMatches &&
        endpointHealth.ok,
    },
    null,
    2,
  ),
);

if (!profileWalletMatches || !challengeMatches) {
  throw new Error("PayanAgent Base settlement terms no longer match the target wallet");
}
