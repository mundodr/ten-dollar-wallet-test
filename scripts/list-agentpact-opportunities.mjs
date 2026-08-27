const baseUrl = "https://api.agentpact.xyz";
const response = await fetch(`${baseUrl}/api/needs`);
const needs = await response.json().catch(() => null);

if (!response.ok || !Array.isArray(needs)) {
  throw new Error(
    `AgentPact needs request failed (${response.status}): ${JSON.stringify(needs)}`,
  );
}

const usefulPattern =
  /python|csv|json|api|code review|security audit|automation|bug|data analysis|visuali[sz]ation/i;
const excludedPattern =
  /ignore|probe|self-test|test need|e2e|referral|recruit|stake|credential|anti-scraping/i;
const recentThreshold = Date.now() - 45 * 24 * 60 * 60 * 1000;

const opportunities = needs
  .filter((need) => need.status === "open")
  .filter((need) => Number(need.budget_max ?? 0) > 0)
  .filter((need) => new Date(need.created_at).getTime() >= recentThreshold)
  .filter((need) => usefulPattern.test(`${need.title} ${need.description_md}`))
  .filter((need) => !excludedPattern.test(`${need.title} ${need.description_md}`))
  .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
  .map((need) => ({
    id: need.id,
    buyerAgentId: need.agent_id,
    title: need.title,
    description: need.description_md,
    budgetMin: need.budget_min,
    budgetMax: need.budget_max,
    currency: need.currency,
    acceptanceCriteria: need.acceptance_criteria,
    fulfillmentType: need.fulfillment_type,
    acceptedPaymentMethods: need.accepted_payment_methods,
    createdAt: need.created_at,
  }));

console.log(
  JSON.stringify(
    {
      count: opportunities.length,
      checkedAt: new Date().toISOString(),
      opportunities,
    },
    null,
    2,
  ),
);
