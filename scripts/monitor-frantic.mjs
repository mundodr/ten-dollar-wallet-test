import { readFile } from "node:fs/promises";
import path from "node:path";

const credentials = JSON.parse(
  await readFile(path.resolve(".frantic/credentials.json"), "utf8"),
);
const headers = {
  Accept: "application/json",
  "User-Agent": "ten-dollar-wallet-worker/1.0",
};

async function fetchJson(url, expectedStatuses = [200]) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(25_000),
      });
      const body = await response.json().catch(() => null);
      if (expectedStatuses.includes(response.status)) {
        return { status: response.status, body };
      }
      lastError = new Error(`HTTP ${response.status} for ${new URL(url).pathname}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError ?? new Error("Monitor request returned no response");
}

const [statusResult, bountyResult, pullRequestResult, sourceyResult] =
  await Promise.all([
    fetchJson(
      `https://gofrantic.com/v1/agents/${encodeURIComponent(credentials.agentKid)}/status`,
    ),
    fetchJson("https://gofrantic.com/v1/bounties/120"),
    fetchJson("https://api.github.com/repos/sourcey/startup-credits/pulls/838"),
    fetchJson("https://api.sourcey.com/v1/entities/by-slug/distribute", [200, 404]),
  ]);

const status = statusResult.body;
const bounty = bountyResult.body?.bounty;
const agent = status?.agent;
const signalSealed = status?.verification?.seals?.signal?.state === "sealed";
const sourceyLive = sourceyResult.status === 200 && sourceyResult.body?.data;
const payoutHint = agent?.onboarding?.payout?.hint ?? credentials.payoutHint ?? null;
const exactPayoutHint = payoutHint === "0x4244..ad18";

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agentKid: credentials.agentKid,
      operator: agent?.operator ?? null,
      emailVerified: signalSealed,
      claimEligibility: agent?.claimEligibility ?? null,
      payout: { ...agent?.onboarding?.payout, hint: payoutHint },
      exactPayoutHint,
      earnedUsd: agent?.earnedUsd ?? null,
      activeWork: status?.work?.summary ?? null,
      bounty: {
        number: bounty?.number ?? null,
        funded: bounty?.funded ?? null,
        workStatus: bounty?.work_status ?? null,
        availableSlots: bounty?.claim_progress?.available ?? null,
        requiredArtifacts: bounty?.required_artifacts ?? [],
      },
      sourceyPullRequest: {
        number: pullRequestResult.body?.number ?? null,
        state: pullRequestResult.body?.state ?? null,
        merged: Boolean(pullRequestResult.body?.merged_at),
        mergedAt: pullRequestResult.body?.merged_at ?? null,
        url: pullRequestResult.body?.html_url ?? null,
      },
      sourceyLive: Boolean(sourceyLive),
      sourceyUrl: sourceyLive ? "https://sourcey.com/distribute" : null,
      claimReady:
        signalSealed &&
        exactPayoutHint &&
        Boolean(pullRequestResult.body?.merged_at) &&
        Boolean(sourceyLive),
      claimBlockedByBountyStarRequirement: true,
    },
    null,
    2,
  ),
);

if (!signalSealed || !exactPayoutHint) {
  throw new Error("Frantic email or payout identity no longer verifies");
}
