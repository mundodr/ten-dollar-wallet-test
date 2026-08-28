import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

async function fetchGitHubJson(apiPath) {
  const { stdout } = await execFileAsync("gh", ["api", apiPath], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  return { status: 200, body: JSON.parse(stdout) };
}

async function readOptionalJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

const deliveryState = await readOptionalJson(path.resolve(".frantic/bounty-127.json"));
const [statusResult, bountyResult, articleBountyResult, pullRequestResult, sourceyResult] =
  await Promise.all([
    fetchJson(
      `https://gofrantic.com/v1/agents/${encodeURIComponent(credentials.agentKid)}/status`,
    ),
    fetchJson("https://gofrantic.com/v1/bounties/120"),
    fetchJson("https://gofrantic.com/v1/bounties/127"),
    fetchGitHubJson("repos/sourcey/startup-credits/pulls/838"),
    fetchJson("https://api.sourcey.com/v1/entities/by-slug/distribute", [200, 404]),
  ]);

const status = statusResult.body;
const bounty = bountyResult.body?.bounty;
const articleBounty = articleBountyResult.body?.bounty;
const agent = status?.agent;
const signalSealed = status?.verification?.seals?.signal?.state === "sealed";
const sourceyLive = sourceyResult.status === 200 && sourceyResult.body?.data;
const payoutHint = agent?.onboarding?.payout?.hint ?? credentials.payoutHint ?? null;
const exactPayoutHint = payoutHint === "0x4244..ad18";
const ownArticleEvents = (articleBounty?.events ?? []).filter((event) =>
  [deliveryState?.claimId, deliveryState?.delivery?.delivery_id]
    .filter(Boolean)
    .some((id) => event?.ref?.includes(id)),
);
const articleRejected = ownArticleEvents.some((event) => event.kind === "REJECTED");

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
      articleBounty: {
        number: articleBounty?.number ?? null,
        funded: articleBounty?.funded ?? null,
        workStatus: articleBounty?.work_status ?? null,
        claimProgress: articleBounty?.claim_progress ?? null,
        ownClaimId: deliveryState?.claimId ?? null,
        ownDeliveryId: deliveryState?.delivery?.delivery_id ?? null,
        ownEvents: ownArticleEvents,
        rejected: articleRejected,
        nextAction: articleRejected
          ? "Do not retry or revise; preserve the explicit rejection and continue other no-deposit routes."
          : deliveryState
            ? "Monitor the submitted article through review and the delayed liveness check."
            : "Claim only after every publication and account-history gate independently verifies.",
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
