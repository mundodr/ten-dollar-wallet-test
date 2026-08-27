#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const API = "https://agentworld.me/api/agentworld";
const TARGET = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const RESULT_PATH = path.resolve(
  "deliverables/agentworld/abf8d62c-1e95-43bc-ac79-5e0fd6a15f54/MARKET_RESEARCH.md",
);
const ATTEMPT_PATH = path.resolve(".agentworld/market-research-attempt.json");

async function getJson(route) {
  const response = await fetch(`${API}${route}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`GET ${route} returned HTTP ${response.status}`);
  return body;
}

let previous;
try {
  previous = JSON.parse(await readFile(ATTEMPT_PATH, "utf8"));
} catch {}
if (previous?.submittedAt || previous?.outcome === "unknown") {
  console.log(JSON.stringify({ status: "not-resubmitted", previous }, null, 2));
  process.exit(0);
}

const credentials = JSON.parse(
  await readFile(path.resolve(".agentworld/credentials.json"), "utf8"),
);
if (credentials.wallet?.toLowerCase() !== TARGET) {
  throw new Error("AgentWorld credentials are not bound to the approved target wallet");
}

const response = await getJson("/jobs");
const jobs = Array.isArray(response) ? response : response?.jobs ?? [];
const job = jobs.find(
  (candidate) => candidate.status === "open" && candidate.description === "Complete market research",
);
if (!job) {
  console.log(JSON.stringify({ status: "no-matching-open-job" }, null, 2));
  process.exit(0);
}
const funded =
  Number(job.escrow_locked) >= Number(job.reward_usdc) &&
  /^0x[0-9a-fA-F]{40}$/.test(job.poster_wallet ?? "") &&
  typeof job.x402_payment_id === "string" &&
  job.x402_payment_id.length > 0;
if (!funded) {
  console.log(
    JSON.stringify(
      {
        status: "not-submitted-unfunded",
        jobId: job.id,
        advertisedRewardUsdc: job.reward_usdc,
        escrowLockedUsdc: job.escrow_locked,
        hasPosterWallet: /^0x[0-9a-fA-F]{40}$/.test(job.poster_wallet ?? ""),
        hasX402PaymentId: Boolean(job.x402_payment_id),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const jobId = job.id;

const result = await readFile(RESULT_PATH, "utf8");
if (result.length < 600 || result.length > 10_000) {
  throw new Error("Market-research deliverable is outside the safe expected size");
}

await mkdir(path.dirname(ATTEMPT_PATH), { recursive: true, mode: 0o700 });
const attemptedAt = new Date().toISOString();
await writeFile(
  ATTEMPT_PATH,
  `${JSON.stringify({ attemptedAt, jobId, outcome: "unknown" }, null, 2)}\n`,
  { mode: 0o600 },
);

let submission;
try {
  const submitResponse = await fetch(`${API}/jobs/tick`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Agent-Key": credentials.apiKey,
      "X-API-Key": credentials.apiKey,
    },
    body: JSON.stringify({ job_id: jobId, agent_wallet: TARGET, result }),
    signal: AbortSignal.timeout(30_000),
  });
  submission = await submitResponse.json().catch(() => null);
  if (!submitResponse.ok) {
    throw new Error(`AgentWorld submission returned HTTP ${submitResponse.status}`);
  }
} catch (error) {
  await writeFile(
    ATTEMPT_PATH,
    `${JSON.stringify({ attemptedAt, jobId, outcome: "unknown", error: error.message }, null, 2)}\n`,
    { mode: 0o600 },
  );
  throw error;
}

const record = {
  attemptedAt,
  submittedAt: new Date().toISOString(),
  jobId,
  outcome: "response-received",
  response: submission,
};
await writeFile(ATTEMPT_PATH, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });

console.log(
  JSON.stringify(
    {
      status: "submitted",
      jobId,
      advertisedRewardUsdc: job.reward_usdc,
      accepted: submission?.accepted ?? submission?.ok ?? null,
      creditedUsdc: submission?.reward_usdc ?? submission?.credited_usdc ?? null,
      payoutStatus: submission?.payout_status ?? null,
      payoutSource: submission?.payout_source ?? null,
      transactionHash: submission?.tx_hash ?? submission?.transaction_hash ?? null,
      countingPolicy: "Count only a matching confirmed Base transfer to the target address.",
    },
    null,
    2,
  ),
);
