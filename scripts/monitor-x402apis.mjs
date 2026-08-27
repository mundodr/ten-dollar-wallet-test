import { readFile } from "node:fs/promises";
import path from "node:path";

const registryUrl = "https://www.x402apis.io/api";
const state = JSON.parse(
  await readFile(path.resolve(".x402apis/registration.json"), "utf8"),
);

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
        throw new Error(
          `HTTP ${response.status} from ${url}: ${JSON.stringify(body)}`,
        );
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

const health = await request(`${state.publicUrl}/health`);
const rows = [];
for (const [api, price] of Object.entries(state.prices)) {
  const discovery = await request(`${registryUrl}/discover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api, limit: 100 }),
  });
  const provider = (discovery?.providers ?? []).find(
    (row) => row.id === state.providerId,
  );
  rows.push({
    api,
    expectedPriceUsdc: price,
    found: Boolean(provider),
    url: provider?.url ?? null,
    wallet: provider?.wallet ?? null,
    priceUsdc: provider?.price ?? null,
    acceptedChains: provider?.acceptedChains ?? [],
    reputation: provider?.reputation ?? null,
    uptime: provider?.uptime ?? null,
    totalServed: provider?.totalServed ?? null,
    lastSeen: provider?.lastSeen ?? null,
    exact:
      provider?.wallet === state.wallet &&
      provider?.url === state.publicUrl &&
      Number(provider?.price) === Number(price) &&
      provider?.acceptedChains?.includes("solana"),
  });
}

const exactHealth =
  health?.status === "ok" &&
  health?.wallet === state.wallet &&
  health?.chains?.includes("solana") &&
  Object.keys(state.prices).every((api) => health?.apis?.includes(api));

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      providerId: state.providerId,
      publicUrl: state.publicUrl,
      directTargetWallet: state.wallet,
      exactHealth,
      health,
      registryRows: rows,
      countingPolicy:
        "Health, discovery, reputation, requests, and earnings counters do not count without an independently verified Solana-mainnet target-wallet receipt.",
    },
    null,
    2,
  ),
);

if (!exactHealth || rows.some((row) => !row.exact)) {
  throw new Error("x402apis provider health or registry terms drifted");
}
