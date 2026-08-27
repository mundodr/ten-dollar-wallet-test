import { readFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://workprotocol.ai/api";
const targetAddress = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const credentials = JSON.parse(
  await readFile(path.resolve(".workprotocol/credentials.json"), "utf8"),
);

async function get(route) {
  const response = await fetch(`${apiBase}${route}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `WorkProtocol GET ${route} failed (${response.status}): ${body?.error ?? body?.message ?? "unknown error"}`,
    );
  }
  return body;
}

const [profileResult, openResult, stats, activity] = await Promise.all([
  get(`/agents/${credentials.agentId}`),
  get("/jobs?status=open&limit=100"),
  get("/stats"),
  get("/activity?limit=20"),
]);
const profile = profileResult?.agent ?? profileResult;
const openJobs = openResult?.jobs ?? [];
const exactWallet =
  profile?.walletAddress?.toLowerCase() === targetAddress ||
  profile?.wallet_address?.toLowerCase() === targetAddress;
const safeOpenJobs = openJobs.filter((job) => {
  const rail = String(job?.paymentRail ?? job?.payment_rail ?? "").toLowerCase();
  const currency = String(
    job?.paymentCurrency ?? job?.payment_currency ?? "",
  ).toUpperCase();
  const escrow = String(
    job?.escrowStatus ?? job?.escrow_status ?? job?.paymentStatus ?? "",
  ).toLowerCase();
  const escrowTxHash =
    job?.escrowTxHash ?? job?.escrow_tx_hash ?? job?.paymentTxHash ?? null;
  const categories = ["code", "data", "research", "custom"];
  return (
    rail === "base" &&
    currency === "USDC" &&
    ["funded", "locked"].includes(escrow) &&
    /^0x[0-9a-f]{64}$/i.test(escrowTxHash ?? "") &&
    categories.includes(job?.category)
  );
});

const summarizeJob = (job) => ({
  id: job?.id ?? null,
  title: job?.title ?? null,
  category: job?.category ?? null,
  status: job?.status ?? null,
  paymentAmount: job?.paymentAmount ?? job?.payment_amount ?? null,
  paymentCurrency: job?.paymentCurrency ?? job?.payment_currency ?? null,
  paymentRail: job?.paymentRail ?? job?.payment_rail ?? null,
  escrowStatus:
    job?.escrowStatus ?? job?.escrow_status ?? job?.paymentStatus ?? null,
  escrowTxHash:
    job?.escrowTxHash ?? job?.escrow_tx_hash ?? job?.paymentTxHash ?? null,
  competitionMode: job?.competitionMode ?? job?.competition_mode ?? null,
  maxWorkers: job?.maxWorkers ?? job?.max_workers ?? null,
  deadline: job?.deadline ?? null,
});

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agentId: credentials.agentId,
      name: profile?.name ?? credentials.name,
      walletAddress: profile?.walletAddress ?? profile?.wallet_address ?? null,
      exactWallet,
      reputationScore: profile?.reputationScore ?? profile?.reputation_score ?? null,
      jobsCompleted: profile?.jobsCompleted ?? profile?.jobs_completed ?? null,
      totalEarned: profile?.totalEarned ?? profile?.total_earned ?? null,
      openJobCount: openJobs.length,
      safeFundedOpenJobCount: safeOpenJobs.length,
      safeFundedOpenJobs: safeOpenJobs.map(summarizeJob),
      otherOpenJobs: openJobs
        .filter((job) => !safeOpenJobs.includes(job))
        .map(summarizeJob),
      platformStats: stats,
      recentActivity: activity?.events ?? [],
      countingPolicy:
        "A candidate requires a plausible escrow tx hash but still needs independent Base receipt and USDC Transfer verification before claim. Registration, claims, deliveries, database records, and platform earnings are not funds. Count only a matching independently verified target-wallet transfer.",
    },
    null,
    2,
  ),
);

if (!exactWallet) throw new Error("WorkProtocol payout wallet has drifted");
