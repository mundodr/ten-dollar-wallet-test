import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { x402ApisProvider } from "./agentictrade-service-api.mjs";

const registryUrl = "https://www.x402apis.io/api";
const statePath = path.resolve(".x402apis/registration.json");

async function request(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { Accept: "application/json", ...options.headers },
        signal: AbortSignal.timeout(25_000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
      }
      return body;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError;
}

const health = await request(`${x402ApisProvider.publicUrl}/health`);
const exactHealth =
  health?.status === "ok" &&
  health?.wallet === x402ApisProvider.wallet &&
  x402ApisProvider.chains.every((chain) => health?.chains?.includes(chain)) &&
  Object.keys(x402ApisProvider.prices).every((api) => health?.apis?.includes(api));
if (!exactHealth) {
  throw new Error("Public x402apis provider health does not match the target terms");
}

async function discover(api) {
  const response = await request(`${registryUrl}/discover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api, limit: 100 }),
  });
  return response?.providers ?? [];
}

async function exactRows() {
  const rows = [];
  for (const [api, price] of Object.entries(x402ApisProvider.prices)) {
    const providers = await discover(api);
    const provider = providers.find(
      (row) => row.id === x402ApisProvider.providerId,
    );
    rows.push({
      api,
      price,
      provider: provider ?? null,
      exact:
        provider?.wallet === x402ApisProvider.wallet &&
        provider?.url === x402ApisProvider.publicUrl &&
        Number(provider?.price) === price &&
        provider?.acceptedChains?.includes("solana"),
    });
  }
  return rows;
}

let rows = await exactRows();
let reused = rows.every((row) => row.exact);
if (!reused) {
  await request(`${registryUrl}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      providerId: x402ApisProvider.providerId,
      apis: Object.keys(x402ApisProvider.prices),
      url: x402ApisProvider.publicUrl,
      prices: x402ApisProvider.prices,
      chains: x402ApisProvider.chains,
    }),
  });
  rows = await exactRows();
}
if (!rows.every((row) => row.exact)) {
  throw new Error(`x402apis registry did not preserve exact terms: ${JSON.stringify(rows)}`);
}

let prior = null;
try {
  prior = JSON.parse(await readFile(statePath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
await mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
await writeFile(
  statePath,
  `${JSON.stringify(
    {
      providerId: x402ApisProvider.providerId,
      wallet: x402ApisProvider.wallet,
      publicUrl: x402ApisProvider.publicUrl,
      chains: x402ApisProvider.chains,
      prices: x402ApisProvider.prices,
      registeredAt: prior?.registeredAt ?? new Date().toISOString(),
      checkedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
await chmod(statePath, 0o600);

console.log(
  JSON.stringify(
    {
      registered: true,
      reused,
      providerId: x402ApisProvider.providerId,
      publicUrl: x402ApisProvider.publicUrl,
      directTargetWallet: true,
      chains: x402ApisProvider.chains,
      apis: rows.map(({ api, price, provider }) => ({
        api,
        priceUsdc: price,
        registryPriceUsdc: provider.price,
        lastSeen: provider.lastSeen,
        totalServed: provider.totalServed,
      })),
      health,
      statePath,
      countingPolicy:
        "Registry rows and provider counters are not funds; only independently verified Solana-mainnet value at the target counts.",
    },
    null,
    2,
  ),
);
