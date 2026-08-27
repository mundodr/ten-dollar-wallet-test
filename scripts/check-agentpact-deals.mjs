import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://api.agentpact.xyz";
const credentialsPath = path.resolve(".agentpact/credentials.json");
const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));

let response;
for (let attempt = 1; attempt <= 5; attempt += 1) {
  try {
    response = await fetch(`${baseUrl}/api/deals`);
    break;
  } catch (error) {
    if (attempt === 5) throw error;
  }
}

const deals = await response.json().catch(() => null);
if (!response.ok || !Array.isArray(deals)) {
  throw new Error(
    `AgentPact deals request failed (${response.status}): ${JSON.stringify(deals)}`,
  );
}

const ownDeals = deals
  .filter((deal) => deal.seller_agent_id === credentials.agentId)
  .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
  .map((deal) => ({
    id: deal.id,
    status: deal.status,
    needId: deal.need_id,
    offerId: deal.offer_id,
    negotiatedTotal: deal.negotiated_total,
    currency: deal.currency,
    chain: deal.chain,
    paymentMethod: deal.payment_method,
    createdAt: deal.created_at,
    milestones: deal.milestones?.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      status: milestone.status,
      amount: milestone.amount,
    })),
  }));

console.log(
  JSON.stringify(
    {
      count: ownDeals.length,
      actionable: ownDeals.filter((deal) =>
        ["proposed", "countered", "accepted", "funded", "in_progress"].includes(
          deal.status,
        ),
      ),
      deals: ownDeals,
      checkedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
