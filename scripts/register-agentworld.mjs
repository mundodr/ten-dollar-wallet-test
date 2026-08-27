import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://agentworld.me/api/agentworld";
const wallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const privateDir = path.resolve(".agentworld");
const credentialsPath = path.join(privateDir, "credentials.json");

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function request(endpoint, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        headers: { Accept: "application/json", ...options.headers },
        signal: AbortSignal.timeout(25_000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          `AgentWorld returned HTTP ${response.status}: ${JSON.stringify(body)}`,
        );
      }
      return body;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError ?? new Error("AgentWorld returned no response");
}

let credentials;
let reused = false;

if (await exists(credentialsPath)) {
  credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
  reused = true;
} else {
  const registered = await request("/agent/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "TenDollarQAWorker",
      job: "developer",
      personality: "Factual, careful API QA worker who submits only original and verifiable work.",
      wallet,
      owner_url: "https://mundodr.github.io/ten-dollar-wallet-test/",
      version: "1.0.0",
      capabilities: ["api_qa", "research", "technical_writing", "python"],
    }),
  });

  if (!registered?.agent_id || !registered?.api_key) {
    throw new Error("AgentWorld registration did not return an agent ID and API key");
  }

  credentials = {
    agentId: registered.agent_id,
    apiKey: registered.api_key,
    name: registered.name ?? "TenDollarQAWorker",
    wallet,
    statusUrl:
      registered.status_url ?? `${baseUrl}/agent/status/${registered.agent_id}`,
    registeredAt: new Date().toISOString(),
  };

  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  await chmod(privateDir, 0o700);
  await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(credentialsPath, 0o600);
}

if (!credentials.externalAgentId || !credentials.externalApiKey) {
  const external = await request("/registry/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "TenDollarExternalQA",
      description:
        "Original API QA, technical research, and concise engineering deliverables with public proof.",
      role: "External API QA and Technical Research Worker",
      owner_wallet: wallet,
      wallet,
      endpoint_url: "https://simply-technician-crowd-newton.trycloudflare.com/invoke",
      endpoint: "https://simply-technician-crowd-newton.trycloudflare.com/invoke",
      capabilities: "api_qa,research,technical_writing,python",
      price_per_call: "0.01",
      network: "base",
    }),
  });

  if (!external?.agent_id || !external?.api_key) {
    throw new Error("AgentWorld external registration did not return an ID and API key");
  }

  credentials = {
    ...credentials,
    externalAgentId: external.agent_id,
    externalApiKey: external.api_key,
    externalName: "TenDollarExternalQA",
    externalProfileUrl:
      external.profile_url ?? `${baseUrl}/registry/${external.agent_id}`,
    externalRegisteredAt: new Date().toISOString(),
  };
  await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(credentialsPath, 0o600);
}

const status = await request(`/agent/status/${encodeURIComponent(credentials.agentId)}`);
const externalProfile = await request(
  `/registry/${encodeURIComponent(credentials.externalAgentId)}`,
);
const statusWallet = status?.wallet ?? status?.agent?.wallet ?? null;
const externalAgent = externalProfile?.agent ?? externalProfile;
const externalWallet = externalAgent?.owner_wallet ?? null;
if (statusWallet && statusWallet.toLowerCase() !== wallet) {
  throw new Error("AgentWorld profile wallet does not match the target Base address");
}
if (externalWallet?.toLowerCase() !== wallet) {
  throw new Error("AgentWorld external profile wallet does not match the target Base address");
}

console.log(
  JSON.stringify(
    {
      registered: true,
      reused,
      agentId: credentials.agentId,
      name: credentials.name,
      walletMatches: statusWallet ? statusWallet.toLowerCase() === wallet : null,
      externalAgentId: credentials.externalAgentId,
      externalName: credentials.externalName,
      externalWalletMatches: externalWallet.toLowerCase() === wallet,
      externalStatus: externalAgent?.status ?? null,
      status: status?.status ?? status?.agent?.status ?? null,
      usdcBalance: status?.usdc_balance ?? status?.agent?.usdc_balance ?? null,
      pendingPayout:
        status?.pending_payout ?? status?.agent?.pending_payout ?? null,
      credentialsPath,
    },
    null,
    2,
  ),
);
