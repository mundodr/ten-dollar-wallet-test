#!/usr/bin/env node

const apiBase = "https://api.moltjobs.io/v1";
const officialBaseUsdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

async function requestJson(pathname) {
  const response = await fetch(`${apiBase}${pathname}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ten-dollar-wallet-test/1.0",
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`MoltJobs ${pathname} returned HTTP ${response.status}`);
  }
  return body;
}

function combinedBrief(job) {
  return [
    job.title,
    job.inputData?.requirements,
    job.inputData?.generalDescription,
    ...(job.acceptanceCriteria ?? []).flatMap((criterion) => [
      criterion.description,
      criterion.check,
    ]),
  ]
    .filter(Boolean)
    .join("\n");
}

function exclusionsFor(job) {
  const brief = combinedBrief(job);
  const exclusions = [];
  if (/50\+\s*(followers|connections)|at least 50 followers/i.test(brief)) {
    exclusions.push("requires an existing public account with at least 50 followers");
  }
  if (/contact the buyer|outreach_message|outreach_channel|cold email|unsolicited dm/i.test(brief)) {
    exclusions.push("requires outbound buyer contact or recorded outreach");
  }
  if (/stake|required deposit|buy bid credits|paid certification/i.test(brief)) {
    exclusions.push("appears to require worker funds");
  }
  return exclusions;
}

const [jobsResponse, statsResponse] = await Promise.all([
  requestJson("/jobs?status=OPEN&limit=50"),
  requestJson("/stats"),
]);
const jobs = Array.isArray(jobsResponse?.data) ? jobsResponse.data : [];
if (!Array.isArray(jobsResponse?.data)) {
  throw new Error("MoltJobs open-job response has an unexpected shape");
}

const classified = jobs.map((job) => {
  const exclusions = exclusionsFor(job);
  const exactBaseUsdc =
    Number(job.chainId) === 8453 &&
    job.tokenSymbol === "USDC" &&
    job.tokenAddress?.toLowerCase() === officialBaseUsdc;
  return {
    id: job.id,
    title: job.title,
    budgetUsdc: Number(job.budgetUsdc ?? 0),
    deadlineAt: job.deadlineAt,
    requiredPackId: job.requiredPackId,
    paymentProvider: job.paymentProvider,
    exactBaseUsdc,
    hasEscrowTransaction: /^0x[0-9a-f]{64}$/i.test(job.escrowTxHash ?? ""),
    exclusions,
    eligibleForFurtherReview: exclusions.length === 0 && exactBaseUsdc,
  };
});

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      platform: {
        totalJobs: statsResponse?.data?.totalJobs ?? null,
        totalCompleted: statsResponse?.data?.totalCompleted ?? null,
        totalVolumeUsdc: statsResponse?.data?.totalVolumeUsdc ?? null,
        escrowedUsdc: statsResponse?.data?.escrowedUsdc ?? null,
      },
      openJobCount: classified.length,
      eligibleForFurtherReview: classified.filter(
        (job) => job.eligibleForFurtherReview,
      ),
      excluded: classified.filter((job) => !job.eligibleForFurtherReview),
      accountState:
        "A one-time email claim was requested, but MoltJobs currently requires a separate Google, GitHub, or X OAuth session before it issues an agent API key.",
      nextAction:
        classified.some((job) => job.eligibleForFurtherReview)
          ? "Inspect each candidate's full schema, authentication gate, and funding evidence before any bid."
          : "Keep monitoring for a no-deposit job that does not require old social reach or unsolicited outreach.",
      countingPolicy:
        "Open jobs, bids, escrow records, platform balances, and completed work do not count until a matching mainnet transfer reaches a disclosed target address.",
    },
    null,
    2,
  ),
);
