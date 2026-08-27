import { readFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://api.useatelier.ai/api";
const targetAddress = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const credentials = JSON.parse(
  await readFile(path.resolve(".atelier/credentials.json"), "utf8"),
);
const authHeaders = {
  Accept: "application/json",
  Authorization: `Bearer ${credentials.apiKey}`,
};

async function get(route, authenticated = false) {
  const response = await fetch(`${apiBase}${route}`, {
    headers: authenticated ? authHeaders : { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success === false) {
    throw new Error(
      `Atelier GET ${route} failed (${response.status}): ${body?.error?.message ?? body?.error ?? "unknown error"}`,
    );
  }
  return body?.data ?? body;
}

function listFrom(data, key) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[key])) return data[key];
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

const [profile, publicProfile, serviceData, actionableData, completedData, bounties, stats, x402Data] =
  await Promise.all([
    get("/agents/me", true),
    get(`/agents/${credentials.agentId}`),
    get(`/agents/${credentials.agentId}/services`, true),
    get(
      `/agents/${credentials.agentId}/orders?status=paid,in_progress,revision_requested`,
      true,
    ),
    get(`/agents/${credentials.agentId}/orders?status=delivered,completed`, true),
    get("/bounties?status=open"),
    get("/platform-stats"),
    get("/x402/services"),
  ]);

const services = listFrom(serviceData, "services");
const actionableOrders = listFrom(actionableData, "orders");
const settledOrders = listFrom(completedData, "orders");
const openBounties = listFrom(bounties, "bounties");
const x402Services = listFrom(x402Data, "services");
const payoutAddress =
  profile?.payout_address_base ?? profile?.payout_wallet ?? profile?.payout_address ?? null;
const exactPayout =
  typeof payoutAddress === "string" &&
  payoutAddress.toLowerCase() === targetAddress &&
  profile?.payout_chain === "base";
const publicAgent = publicProfile?.agent ?? publicProfile;
const publicServices = listFrom(publicProfile, "services");
const exactPublicListing =
  publicAgent?.id === credentials.agentId &&
  publicServices.some(
    (service) =>
      service?.title === "API Brief Acceptance Checklist" &&
      service?.active === 1 &&
      Number(service?.price_usd) === 0.01 &&
      service?.payout_chain === "base" &&
      service?.payout_address_base?.toLowerCase() === targetAddress,
  );
const x402Listed = x402Services.some(
  (service) => service?.title === "API Brief Acceptance Checklist",
);

const summarizeOrder = (order) => ({
  id: order?.id ?? order?.order_id ?? null,
  status: order?.status ?? null,
  serviceId: order?.service_id ?? null,
  priceUsd: order?.price_usd ?? order?.amount_usd ?? null,
  brief: typeof order?.brief === "string" ? order.brief.slice(0, 500) : order?.brief ?? null,
  escrowTxHash: order?.escrow_tx_hash ?? order?.payment_tx_hash ?? null,
  payoutTxHash: order?.payout_tx_hash ?? order?.settlement_tx_hash ?? null,
  updatedAt: order?.updated_at ?? null,
});

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agentId: credentials.agentId,
      slug: credentials.slug ?? profile?.slug ?? null,
      marketable: profile?.marketable ?? null,
      verified: profile?.verified ?? null,
      publicAgentName: publicAgent?.name ?? null,
      exactPublicListing,
      x402Listed,
      payoutChain: profile?.payout_chain ?? null,
      payoutAddress,
      exactPayout,
      services: services.map((service) => ({
        id: service?.id ?? service?.service_id ?? null,
        title: service?.title ?? null,
        category: service?.category ?? null,
        priceUsd: service?.price_usd ?? null,
        priceType: service?.price_type ?? null,
        active: service?.active ?? null,
        totalOrders: service?.total_orders ?? null,
      })),
      actionableOrders: actionableOrders.map(summarizeOrder),
      settledOrders: settledOrders.map(summarizeOrder),
      openBountyCount: openBounties.length,
      openBounties: openBounties.slice(0, 20).map((bounty) => ({
        id: bounty?.id ?? bounty?.bounty_id ?? null,
        title: bounty?.title ?? null,
        budgetUsd: bounty?.budget_usd ?? bounty?.amount_usd ?? null,
        status: bounty?.status ?? null,
        claims: bounty?.claim_count ?? bounty?.claims_count ?? null,
      })),
      platformStats: stats,
      note:
        "Orders, platform revenue, and escrow are not target-wallet payment evidence. Count only an independently verified matching mainnet transfer.",
    },
    null,
    2,
  ),
);

if (!exactPayout || !exactPublicListing) {
  throw new Error("Atelier payout destination or public listing has drifted");
}
