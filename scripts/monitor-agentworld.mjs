import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://agentworld.me/api/agentworld";
const targetWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const credentials = JSON.parse(
  await readFile(path.resolve(".agentworld/credentials.json"), "utf8"),
);

async function fetchJson(endpoint) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(25_000),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) return body;
      lastError = new Error(`AgentWorld returned HTTP ${response.status} for ${endpoint}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError ?? new Error("AgentWorld returned no response");
}

const [status, externalProfile, jobsResponse] = await Promise.all([
  fetchJson(`/agent/status/${encodeURIComponent(credentials.agentId)}`),
  fetchJson(`/registry/${encodeURIComponent(credentials.externalAgentId)}`),
  fetchJson("/jobs"),
]);
const agent = status?.agent ?? status;
const externalAgent = externalProfile?.agent ?? externalProfile;
const jobs = Array.isArray(jobsResponse) ? jobsResponse : jobsResponse?.jobs ?? [];
const wallet = agent?.wallet ?? credentials.wallet ?? null;
const exactWallet = wallet?.toLowerCase() === targetWallet;
const externalWallet = externalAgent?.owner_wallet ?? null;
const exactExternalWallet = externalWallet?.toLowerCase() === targetWallet;
const openJobs = jobs.filter((job) => job.status === "open");

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agentId: credentials.agentId,
      name: credentials.name,
      status: agent?.status ?? null,
      wallet,
      exactWallet,
      externalAgentId: credentials.externalAgentId,
      externalName: credentials.externalName,
      externalStatus: externalAgent?.status ?? null,
      externalWallet,
      exactExternalWallet,
      externalCalls: externalAgent?.call_count ?? null,
      externalEarningsUsdc: externalAgent?.earnings_usdc ?? null,
      inWorldUsdcBalance: agent?.usdc_balance ?? agent?.balance_usdc ?? null,
      pendingPayout: agent?.pending_payout ?? agent?.pending_usdc ?? null,
      paidUsdc: agent?.paid_usdc ?? agent?.total_paid_usdc ?? null,
      payoutTxHash: agent?.payout_tx_hash ?? agent?.last_payout_tx_hash ?? null,
      openJobCount: openJobs.length,
      openJobs: openJobs.map((job) => ({
        id: job.id,
        title: job.title,
        description: job.description,
        category: job.category ?? null,
        rewardUsdc: job.reward_usdc,
        requiredSkills: job.required_skills ?? [],
        expiresAt: job.expires_at,
      })),
    },
    null,
    2,
  ),
);

if (!exactWallet || !exactExternalWallet) {
  throw new Error("AgentWorld profiles are not bound to the target Base address");
}
