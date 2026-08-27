import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://basilisk-api.fly.dev/api";
const credentialsDir = path.resolve(".basilisk");
const credentialsPath = path.join(credentialsDir, "credentials.json");
const targetWallets = {
  solana: "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt",
  base: "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18",
};

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function requestJson(pathname, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(`${apiBase}${pathname}`, {
        ...options,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(`Basilisk ${pathname} failed (${response.status})`);
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < 4 && (error.status === 429 || error.status >= 500 || !error.status)) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
await chmod(credentialsDir, 0o700);

let credentials;
let registered = false;
try {
  credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  const registration = await requestJson("/agents", {
    method: "POST",
    body: JSON.stringify({
      name: "ten-dollar-wallet-qa",
      type: "ai",
      specialization: "code",
      capabilities: {
        skills: [
          "api-testing",
          "csv-json-transformation",
          "code-review",
          "documentation",
        ],
        inputFormats: ["json", "csv", "markdown", "text"],
        outputFormats: ["json", "csv", "markdown"],
        maxConcurrentJobs: 2,
        languages: ["en", "zh"],
      },
    }),
  });
  const data = registration?.data ?? registration;
  const agent = data?.agent ?? data;
  credentials = {
    agentId: agent?.id,
    apiKey: data?.apiKey ?? registration?.apiKey,
    jwt: data?.jwt ?? registration?.jwt,
    registration,
    registeredAt: new Date().toISOString(),
    wallets: {},
  };
  if (!credentials.agentId || !credentials.apiKey) {
    throw new Error("Basilisk registration omitted agent ID or API key");
  }
  await writePrivateJson(credentialsPath, credentials);
  registered = true;
}

for (const [chain, walletAddress] of Object.entries(targetWallets)) {
  if (credentials.wallets?.[chain]?.walletAddress === walletAddress) continue;
  const result = await requestJson(`/agents/${credentials.agentId}/wallet`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.jwt}` },
    body: JSON.stringify({ walletAddress, chain }),
  });
  credentials.wallets = {
    ...credentials.wallets,
    [chain]: {
      walletAddress,
      linkedAt: new Date().toISOString(),
      response: result,
    },
  };
  await writePrivateJson(credentialsPath, credentials);
}

const profile = await requestJson(`/agents/${credentials.agentId}`, {
  headers: { Authorization: `Bearer ${credentials.jwt}` },
});
const agent = profile?.data?.agent ?? profile?.data ?? profile?.agent ?? profile;
const activeWallet = agent?.walletAddress ?? null;

console.log(
  JSON.stringify(
    {
      registered,
      agentId: credentials.agentId,
      name: agent?.name ?? null,
      status: agent?.status ?? null,
      activeWallet,
      baseWalletConfigured:
        activeWallet?.toLowerCase() === targetWallets.base,
      solanaWalletConfigured: activeWallet === targetWallets.solana,
      privateCredentials: credentialsPath,
    },
    null,
    2,
  ),
);
