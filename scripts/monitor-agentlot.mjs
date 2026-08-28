import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://agentlot.io";
const stateDirectory = path.resolve(".agentlot");
const credentialsPath = path.join(stateDirectory, "credentials.json");
const statusPath = path.join(stateDirectory, "status.json");
const credentials = JSON.parse(await fs.readFile(credentialsPath, "utf8"));

async function request(resource, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${resource}`, {
        ...options,
        signal: AbortSignal.timeout(20_000),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${credentials.apiKey}`,
          "user-agent": "ten-dollar-wallet-worker/1.0",
          ...(options.headers ?? {}),
        },
      });
      const raw = await response.text();
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        body = { raw: raw.slice(0, 2000) };
      }
      return { ok: response.ok, status: response.status, body };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return { ok: false, status: 0, error: lastError?.message ?? "request failed" };
}

async function mcpCall(name, args = {}) {
  return request("/mcp-v930", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}

const routes = {
  onboarding: "/api/v1/agents/onboarding/status",
  realSources: "/api/v1/real-sources",
  workFeed: "/api/v1/work/feed",
  rankedWork: "/api/v1/agent-network/best-work?limit=200",
  opportunities: "/api/earn/opportunities",
  requests: "/api/requests",
  externalDemand: "/api/earn/external",
  stats: "/api/stats",
  growth: "/api/v1/growth/stats",
};
const api = Object.fromEntries(
  await Promise.all(
    Object.entries(routes).map(async ([name, resource]) => [name, await request(resource)]),
  ),
);
const contributor = await mcpCall("my_agentlot_stats");

function rows(result, keys) {
  const body = result?.body;
  if (Array.isArray(body)) return body;
  for (const key of keys) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

const work = rows(api.workFeed, ["items", "opportunities", "results"]);
const opportunities = [
  ...rows(api.opportunities, ["items", "opportunities", "results"]),
  ...rows(api.requests, ["items", "requests", "results"]),
  ...rows(api.externalDemand, ["items", "opportunities", "results"]),
];
const rewardStates = Object.fromEntries(
  [...new Set(work.map((item) => item?.reward_state ?? "UNKNOWN"))].map((state) => [
    state,
    work.filter((item) => (item?.reward_state ?? "UNKNOWN") === state).length,
  ]),
);
const disallowed =
  /\b(deposit|stake|bond|kyc|identity document|passport|phone|captcha|follow|retweet|like|discord|telegram|outreach|cold[- ]?email|private key|seed phrase|credential|production access)\b/i;
const fundedStates = new Set(["FUNDED", "ESCROWED", "GUARANTEED"]);
const fundedCandidates = [...work, ...opportunities].filter((item) => {
  const state = String(item?.reward_state ?? item?.funding_state ?? "").toUpperCase();
  const funded = fundedStates.has(state) || item?.funded === true || item?.escrowed === true;
  const reward = Number(
    item?.reward_usd ?? item?.reward_usdc ?? item?.budget_usd ?? item?.budget_usdc ?? 0,
  );
  return funded && reward > 0 && !disallowed.test(JSON.stringify(item));
});
const onboarding = api.onboarding?.body ?? {};
const verifiedCount = Number(onboarding?.verified_self_service_agents ?? 0);
const leaseGate = onboarding?.lease_gate ?? null;
// The onboarding endpoint exposes only a global verified-agent count. Never
// mistake another agent's verification for this credential's authorization.
const canLease = credentials.canLease === true;

const snapshot = {
  checkedAt: new Date().toISOString(),
  agent: {
    agentId: credentials.agentId,
    contributorAgentId: credentials.contributorAgentId,
    principalId: credentials.principalId,
    displayName: credentials.displayName,
    forwardingTarget: credentials.forwardingTarget,
    savedVerificationState: credentials.verificationState,
  },
  identity: {
    leaseGate,
    verifiedSelfServiceAgents: verifiedCount,
    canLease,
    moltbook: onboarding?.moltbook ?? null,
  },
  feed: {
    total: work.length,
    rewardStates,
    fundedCandidateCount: fundedCandidates.length,
    fundedCandidates,
  },
  nativePaidRequests: rows(api.requests, ["items", "requests", "results"]),
  externalDemand: rows(api.externalDemand, ["items", "opportunities", "results"]),
  contributor,
  api,
  nextAction:
    fundedCandidates.length > 0 && canLease
      ? "Inspect exact scope, settlement evidence, and claim requirements before leasing one task."
      : "Keep monitoring. Do not lease contingent work or bypass the VERIFIED identity gate.",
  countingPolicy:
    "Registration, leases, contribution rows, CONTINGENT prize values, and platform projections are not funds. Count only an independently verified receipt at an exact disclosed target address.",
};

await fs.writeFile(statusPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
  mode: 0o600,
});
await fs.chmod(statusPath, 0o600);

console.log(
  JSON.stringify(
    {
      checkedAt: snapshot.checkedAt,
      agent: snapshot.agent,
      identity: snapshot.identity,
      feed: snapshot.feed,
      nativePaidRequestCount: snapshot.nativePaidRequests.length,
      externalDemandCount: snapshot.externalDemand.length,
      contributor: snapshot.contributor,
      nextAction: snapshot.nextAction,
      countingPolicy: snapshot.countingPolicy,
    },
    null,
    2,
  ),
);
