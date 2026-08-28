import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://payanagent.com";
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const baseRpc = "https://mainnet.base.org";
const transferTopic =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
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

async function rpc(method, params) {
  const response = await fetch(baseRpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.error) {
    throw new Error(`Base RPC ${method} failed`);
  }
  return body.result;
}

function topicAddress(topic) {
  return typeof topic === "string" && topic.length === 66
    ? `0x${topic.slice(-40)}`.toLowerCase()
    : null;
}

async function usdcBalance(address) {
  if (!/^0x[0-9a-f]{40}$/i.test(address ?? "")) return null;
  const data = `0x70a08231${address.toLowerCase().slice(2).padStart(64, "0")}`;
  return BigInt(await rpc("eth_call", [{ to: baseUsdc, data }, "latest"]));
}

const [profile, offer, receipts, catalogTask, openRequests] = await Promise.all([
  json(`/api/v1/agents/${encodeURIComponent(credentials.agentId)}`),
  json(`/api/v1/offers/${encodeURIComponent(state.offerId)}`),
  json(`/api/v1/agents/${encodeURIComponent(credentials.agentId)}/receipts?side=seller&limit=100`),
  json(`/api/v1/requests/${encodeURIComponent(catalogTaskId)}`),
  json("/api/v1/requests?status=open&limit=100"),
]);

const catalogRequest = catalogTask.body?.request;
const escrowReceiptId = catalogRequest?.escrowReceiptId;
const escrowReceipt = escrowReceiptId
  ? await json(`/api/v1/receipts/${encodeURIComponent(escrowReceiptId)}`)
  : { response: { ok: false }, body: null };
const escrowRecord = escrowReceipt.body?.receipt ?? escrowReceipt.body;
let escrowOnChain = {
  txHash: escrowRecord?.txHash ?? null,
  transactionSucceeded: false,
  officialUsdcTransfer: null,
  selfTransfer: null,
  platformWalletBalanceUsdc: null,
};
if (/^0x[0-9a-f]{64}$/i.test(escrowRecord?.txHash ?? "")) {
  const chainReceipt = await rpc("eth_getTransactionReceipt", [escrowRecord.txHash]);
  const transfer = (chainReceipt?.logs ?? []).find(
    (log) =>
      log.address?.toLowerCase() === baseUsdc.toLowerCase() &&
      log.topics?.[0]?.toLowerCase() === transferTopic,
  );
  const from = topicAddress(transfer?.topics?.[1]);
  const to = topicAddress(transfer?.topics?.[2]);
  const amountBaseUnits = transfer ? BigInt(transfer.data) : null;
  const balance = to ? await usdcBalance(to) : null;
  escrowOnChain = {
    txHash: escrowRecord.txHash,
    transactionSucceeded: chainReceipt?.status === "0x1",
    officialUsdcTransfer: transfer
      ? {
          from,
          to,
          amountBaseUnits: amountBaseUnits.toString(),
          amountUsdc: Number(amountBaseUnits) / 1e6,
        }
      : null,
    selfTransfer: from !== null && from === to,
    platformWalletBalanceUsdc: balance === null ? null : Number(balance) / 1e6,
  };
}
const publicOpenRequests = openRequests.body?.requests ?? [];
const openEscrowLiabilityCents = publicOpenRequests
  .filter((request) => request.escrow)
  .reduce((total, request) => total + Number(request.escrowDepositedCents ?? 0), 0);
const observedPlatformBalanceCents = Math.round(
  Number(escrowOnChain.platformWalletBalanceUsdc ?? 0) * 100,
);

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
const selectedAsProvider = catalogRequest?.providerId === credentials.agentId;

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
        requestTitle: catalogRequest?.title,
        requestStatus: catalogRequest?.status,
        providerId: catalogRequest?.providerId ?? null,
        bidCount: (catalogTask.body?.bids ?? []).length,
        escrowDepositedCents: catalogRequest?.escrowDepositedCents,
        escrowReceiptId: escrowReceiptId ?? null,
        bidId: catalogBidId,
        bidStatus: catalogBid?.status ?? "not_found",
        bidPriceCents: catalogBid?.priceCents ?? null,
        selectedAsProvider,
        deliveryReady: catalogRequest?.status === "accepted" && selectedAsProvider,
        preparedDeliverable:
          "deliverables/payanagent/catalog-health-checker/sample-report",
      },
      catalogTaskEscrow: {
        receiptStatus: escrowRecord?.status ?? null,
        receiptSettlementType: escrowRecord?.settlementType ?? null,
        ...escrowOnChain,
        openEscrowLiabilityCents,
        observedPlatformBalanceCents,
        coversVisibleOpenEscrows:
          observedPlatformBalanceCents >= openEscrowLiabilityCents,
        independentlySegregated:
          escrowOnChain.transactionSucceeded &&
          escrowOnChain.officialUsdcTransfer?.amountBaseUnits ===
            String(Number(catalogRequest?.escrowDepositedCents ?? 0) * 10_000) &&
          escrowOnChain.selfTransfer === false,
        caveat:
          "Visible collateral can cover visible open escrows, but a self-transfer does not lock funds per task.",
      },
      allChecksSucceeded:
        profile.response.ok &&
        offer.response.ok &&
        receipts.response.ok &&
        catalogTask.response.ok &&
        openRequests.response.ok &&
        escrowReceipt.response.ok &&
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
