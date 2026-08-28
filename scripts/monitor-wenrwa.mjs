const apiBase = "https://api.wenrwa.com/api/v1";

async function fetchJson(route, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${apiBase}${route}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text.slice(0, 500) };
      }
      if (!response.ok) {
        throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
    }
  }
  throw lastError;
}

const [openResponse, agentsResponse, feesResponse] = await Promise.all([
  fetchJson("/bounties?status=open&limit=100"),
  fetchJson("/agents?limit=100"),
  fetchJson("/fees"),
]);

const openBounties = Array.isArray(openResponse?.bounties)
  ? openResponse.bounties
  : [];
const agents = Array.isArray(agentsResponse?.agents) ? agentsResponse.agents : [];

function rawUsdc(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric / 1_000_000 : 0;
}

const earningLeaders = agents
  .map((agent) => ({
    wallet: agent.walletPubkey ?? null,
    name: agent.name ?? null,
    completedBounties: Number(agent.completedCount ?? agent.completedBounties ?? 0),
    earnedUsdc: rawUsdc(agent.totalEarned ?? agent.totalEarnings),
  }))
  .filter((agent) => agent.completedBounties > 0 || agent.earnedUsdc > 0)
  .sort((a, b) => b.earnedUsdc - a.earnedUsdc)
  .slice(0, 10);

const candidates = openBounties.map((bounty) => {
  const schemaText = JSON.stringify(bounty.taskSchema ?? {}).toLowerCase();
  const rewardUsdc = rawUsdc(bounty.rewardAmount ?? bounty.rewardAmountRaw);
  const bondUsdc = rawUsdc(
    bounty.agentBondAmount ?? bounty.workerBondAmount ?? bounty.bondAmount,
  );
  const sociallyRestricted =
    /social|twitter|\bx\b|reddit|followers|outreach|contact\s+(?:the\s+)?buyer/.test(
      schemaText,
    );
  return {
    id: bounty.id ?? null,
    title: bounty.title ?? null,
    category: bounty.category ?? null,
    rewardUsdc,
    bondUsdc,
    deadline: bounty.deadline ?? null,
    sociallyRestricted,
    noDepositCandidate: rewardUsdc > 0 && bondUsdc === 0 && !sociallyRestricted,
  };
});

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      network: "Solana mainnet",
      openBountyCount: Number(openResponse?.total ?? openBounties.length),
      candidates,
      noDepositCandidateCount: candidates.filter(
        (candidate) => candidate.noDepositCandidate,
      ).length,
      registeredAgentCount: Number(agentsResponse?.total ?? agents.length),
      visibleEarningLeaders: earningLeaders,
      fees: {
        posterGasFeeUsdc: Number(feesResponse?.fees?.gasFeeUsdc ?? 0),
        standardPlatformFeePercent:
          Number(feesResponse?.fees?.platformFeeBps ?? 0) / 100,
      },
      registrationState: "not-created",
      registrationPolicy:
        "Do not create a worker merely for an empty board. Before registration, prove a zero-user-funds path from any worker receipt to the exact disclosed Solana target.",
      countingPolicy:
        "Bounties, bids, assignments, platform earnings, and intermediary-wallet receipts are not goal funds. Count only an independently verified mainnet receipt at the disclosed Solana target.",
    },
    null,
    2,
  ),
);
