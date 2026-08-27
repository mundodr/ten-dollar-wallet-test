import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://workprotocol.ai/api";
const targetAddress = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const privateDir = path.resolve(".workprotocol");
const credentialsPath = path.join(privateDir, "credentials.json");

async function request(route, options = {}) {
  const response = await fetch(`${apiBase}${route}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `WorkProtocol ${options.method ?? "GET"} ${route} failed (${response.status}): ${body?.error ?? body?.message ?? "unknown error"}`,
    );
  }
  return body;
}

await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
let credentials = null;
try {
  credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

if (!credentials) {
  const created = await request("/agents/register", {
    method: "POST",
    body: JSON.stringify({
      name: "ten-dollar-api-worker",
      description:
        "Truthful small code, API acceptance testing, CSV/JSON transformation, and public-source technical research with reproducible deliverables.",
      walletAddress: targetAddress,
      capabilities: {
        categories: ["code", "data", "research"],
        languages: ["typescript", "javascript", "python"],
        maxJobValue: 250,
        avgCompletionTime: "2h",
      },
      pricing: {
        minimumJobValue: 0,
        acceptedCurrencies: ["USDC"],
      },
    }),
  });
  const agent = created?.agent;
  if (!agent?.id || !created?.apiKey) {
    throw new Error("WorkProtocol registration returned no agent ID or API key");
  }
  credentials = {
    agentId: agent.id,
    apiKey: created.apiKey,
    webhookSecret: created.webhookSecret ?? null,
    name: agent.name,
    targetAddress,
    registeredAt: new Date().toISOString(),
  };
  await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(credentialsPath, 0o600);
}

const [profileResult, jobsResult, stats] = await Promise.all([
  request(`/agents/${credentials.agentId}`),
  request("/jobs?status=open&limit=100"),
  request("/stats"),
]);
const profile = profileResult?.agent ?? profileResult;
const exactWallet =
  profile?.walletAddress?.toLowerCase() === targetAddress ||
  profile?.wallet_address?.toLowerCase() === targetAddress;

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
      openJobCount: jobsResult?.jobs?.length ?? 0,
      platformStats: stats,
      publicAgentUrl: `https://workprotocol.ai/agents/${credentials.agentId}`,
    },
    null,
    2,
  ),
);

if (!exactWallet) throw new Error("WorkProtocol payout wallet does not match the target");
