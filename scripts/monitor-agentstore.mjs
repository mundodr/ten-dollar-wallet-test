import { readFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://api.agentstore.tools/api";
const credentialsPath = path.resolve(".agentstore/credentials.json");
const listingPath = path.resolve(".agentstore/listing.json");
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";

async function requestJson(pathname, options = {}, allowedStatuses = []) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok && !allowedStatuses.includes(response.status)) {
    throw new Error(`AgentStore ${pathname} failed (${response.status})`);
  }
  return { status: response.status, body };
}

function containsString(value, expected) {
  if (typeof value === "string") return value.toLowerCase().includes(expected.toLowerCase());
  if (Array.isArray(value)) return value.some((item) => containsString(item, expected));
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => containsString(item, expected));
  }
  return false;
}

const [credentials, listing] = await Promise.all([
  readFile(credentialsPath, "utf8").then(JSON.parse),
  readFile(listingPath, "utf8").then(JSON.parse),
]);
const agentId = listing?.agent?.agent_id ?? listing?.agent_id;
const auth = { "X-API-Key": credentials.apiKey };
const [profileResponse, publicResponse, accessResponse, earnResponse, programResponse] =
  await Promise.all([
    requestJson("/publishers/me", { headers: auth }),
    requestJson(`/agents/${encodeURIComponent(agentId)}`),
    requestJson(
      `/agents/${encodeURIComponent(agentId)}/access`,
      { headers: { "X-Wallet-Address": targetBaseWallet } },
      [402],
    ),
    requestJson("/publishers/me/earn-program", { headers: auth }),
    requestJson("/earn-program"),
  ]);

const profile = profileResponse.body?.publisher ?? profileResponse.body;
const agent = publicResponse.body?.agent ?? publicResponse.body;
const exactBasePayout = profile?.payout_address?.toLowerCase() === targetBaseWallet;
const challengeNamesTarget = containsString(accessResponse.body, targetBaseWallet);
if (!exactBasePayout || accessResponse.status !== 402 || !challengeNamesTarget) {
  throw new Error("AgentStore payout profile or payment challenge drifted");
}
if (agent?.pricing?.model !== "one_time" || Number(agent?.pricing?.amount) !== 0.1) {
  throw new Error("AgentStore paid listing drifted");
}

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      publisherId: credentials.publisherId,
      exactBasePayout,
      agentId,
      name: agent.name,
      type: agent.type,
      pricing: agent.pricing,
      accessStatus: accessResponse.status,
      challengeNamesTarget,
      totalAgents: profile.total_agents ?? null,
      totalSales: profile.total_sales ?? 0,
      totalEarnings: profile.total_earnings ?? 0,
      monthlyEarnings: profile.monthly_earnings ?? 0,
      publisherEarnProgram: earnResponse.body?.current_month ?? null,
      platformEarnProgram: programResponse.body?.current_month ?? null,
      note:
        "AgentStore sale counters are secondary evidence; only a matching target Base transfer counts toward the goal.",
    },
    null,
    2,
  ),
);
