#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const marketplaceUrl = "https://app.hober.dev/api/marketplace/jobs";
const stateDirectory = path.resolve(".hober");
const statusPath = path.join(stateDirectory, "status.json");
const maximumFeeRate = 0.1;
const targetNetUsd = 10;
const minimumGrossUsd = targetNetUsd / (1 - maximumFeeRate);

async function requestJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "ten-dollar-wallet-monitor/1.0",
        },
        signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`Hober returned non-JSON content (${response.status})`);
      }
      if (!response.ok) {
        throw new Error(`Hober marketplace request failed (${response.status}): ${JSON.stringify(body)}`);
      }
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

function amount(job) {
  const value = Number(job?.budgetUsd);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function isOpen(job) {
  return ["OPEN", "FUNDED", "BIDDING"].includes(String(job?.status ?? "").toUpperCase());
}

function isUnassigned(job) {
  const provider = String(job?.provider ?? "").trim().toLowerCase();
  return !provider || /^0x0{40}$/.test(provider);
}

const payload = await requestJson(marketplaceUrl);
if (!Array.isArray(payload.jobs) || payload.mock !== false) {
  throw new Error("Hober public marketplace response is missing a confirmed non-mock jobs array");
}

const openJobs = payload.jobs.filter(isOpen);
const positiveOpenJobs = openJobs.filter((job) => amount(job) > 0);
const actionableCandidates = positiveOpenJobs.filter(
  (job) => isUnassigned(job) && amount(job) >= minimumGrossUsd,
);
const largestPositiveOpenBudget = positiveOpenJobs.reduce(
  (largest, job) => Math.max(largest, amount(job)),
  0,
);

const snapshot = {
  checkedAt: new Date().toISOString(),
  source: marketplaceUrl,
  responseMarkedNonMock: payload.mock === false,
  totalJobs: payload.total ?? payload.jobs.length,
  returnedJobs: payload.jobs.length,
  openJobs: openJobs.length,
  positiveOpenJobs: positiveOpenJobs.length,
  largestPositiveOpenBudgetUsd: largestPositiveOpenBudget,
  maximumPublishedCommerceFeeRate: maximumFeeRate,
  minimumGrossUsdForTenNet: Number(minimumGrossUsd.toFixed(6)),
  actionableCandidates,
  registrationPolicy: {
    registerNow: actionableCandidates.length > 0,
    reason:
      actionableCandidates.length > 0
        ? "A large enough unassigned public row exists. Verify its Base-mainnet escrow independently before registration or work."
        : "No unassigned public row can net 10 USDC after Hober's maximum published commerce fee. Do not create an unnecessary account.",
    walletConstraint:
      "Hober verifies the listing wallet by signature. Never request or use the disclosed target wallet's private key; a project-only embedded wallet may be considered only for a verified funded opportunity and must forward any legitimate payout to the exact Base target.",
  },
  evidencePolicy:
    "A public API row is not proof of escrow or payment. Before bidding, independently verify the specific Base-mainnet escrow and that no deposit, stake, bond, paid inference, or user funds are required.",
  countingPolicy:
    "Registration, listings, bids, jobs, scores, and intermediary balances do not count. Only an independently verified matching mainnet receipt at the disclosed target counts.",
};

await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
await fs.chmod(stateDirectory, 0o700);
await fs.writeFile(statusPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
  mode: 0o600,
});
await fs.chmod(statusPath, 0o600);
console.log(JSON.stringify(snapshot, null, 2));
