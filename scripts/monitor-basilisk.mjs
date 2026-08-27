import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://basilisk-api.fly.dev/api";
const credentialsPath = path.resolve(".basilisk/credentials.json");
const targetWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`Basilisk ${pathname} failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function refreshJwt(credentials) {
  const response = await fetch(`${apiBase}/auth/login`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId: credentials.agentId,
      apiKey: credentials.apiKey,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Basilisk JWT refresh failed (${response.status})`);
  credentials.jwt = body?.jwt ?? body?.data?.jwt;
  if (!credentials.jwt) throw new Error("Basilisk JWT refresh omitted a token");
  credentials.jwtRefreshedAt = new Date().toISOString();
  await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(credentialsPath, 0o600);
}

const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
let auth = { Authorization: `Bearer ${credentials.jwt}` };
let profile;
try {
  profile = await requestJson(`/agents/${credentials.agentId}`, { headers: auth });
} catch (error) {
  if (error.status !== 401) throw error;
  await refreshJwt(credentials);
  auth = { Authorization: `Bearer ${credentials.jwt}` };
  profile = await requestJson(`/agents/${credentials.agentId}`, { headers: auth });
}

const [stats, jobs, recommended, inbox, services] = await Promise.all([
  requestJson("/stats"),
  requestJson("/jobs?status=open&limit=100"),
  requestJson(`/agents/${credentials.agentId}/recommended-jobs`, { headers: auth }),
  requestJson(`/agents/${credentials.agentId}/inbox`, { headers: auth }),
  requestJson(`/services?agentId=${credentials.agentId}&limit=100`),
]);

const agent = profile?.agent ?? profile?.data?.agent ?? profile?.data ?? profile;
const serviceList = (services.services ?? services.data?.services ?? []).filter(
  (service) => service.agentId === credentials.agentId,
);
const openJobs = jobs.jobs ?? jobs.data?.jobs ?? jobs.data ?? [];

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agentId: credentials.agentId,
      name: agent?.name ?? null,
      activeWallet: agent?.walletAddress ?? null,
      exactBaseWallet: agent?.walletAddress?.toLowerCase() === targetWallet,
      totalEarned: agent?.totalEarned ?? 0,
      jobsCompleted: agent?.jobsCompleted ?? 0,
      openJobCount: openJobs.length,
      recommendedJobCount: recommended?.recommended?.length ?? 0,
      inboxCount: inbox?.total ?? inbox?.messages?.length ?? 0,
      serviceCount: serviceList.length,
      services: serviceList.map((service) => ({
        id: service.id,
        title: service.title,
        status: service.status,
        chain: service.chain,
        totalOrders: service.totalOrders ?? 0,
      })),
      platformStats: stats?.stats ?? stats,
    },
    null,
    2,
  ),
);
