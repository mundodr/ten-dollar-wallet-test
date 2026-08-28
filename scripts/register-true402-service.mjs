import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { x402ServiceManifest } from "./agentictrade-service-api.mjs";

const registryUrl = "https://true402.dev/api/v1/services";
const manifestBaseUrl =
  "https://begins-greatly-badge-dealers.trycloudflare.com";
const privateDir = path.resolve(".true402");
const statePath = path.join(privateDir, "listing.json");

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }
  throw lastError;
}

const manifestResponse = await fetchWithRetry(
  new URL("/.well-known/x402-service.json", manifestBaseUrl),
);
const liveManifest = await manifestResponse.json().catch(() => null);
if (
  !manifestResponse.ok ||
  JSON.stringify(liveManifest) !== JSON.stringify(x402ServiceManifest)
) {
  throw new Error("The public true402 manifest is unavailable or has drifted");
}

await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);

let state;
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

if (state?.registered) {
  console.log(
    JSON.stringify({
      registered: false,
      reused: true,
      listingId: state.listingId ?? null,
      manifestBaseUrl,
      endpoint: x402ServiceManifest.endpoint,
    }),
  );
  process.exit(0);
}

const response = await fetchWithRetry(registryUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "User-Agent": "ten-dollar-wallet-test/1.0",
  },
  body: JSON.stringify({ url: manifestBaseUrl, manifest: liveManifest }),
});
const body = await response.json().catch(() => null);
if (!response.ok) {
  throw new Error(
    `true402 registration failed (${response.status}): ${JSON.stringify(body)}`,
  );
}

const listing = body?.service ?? body?.listing ?? body;
const listingId = listing?.id ?? body?.id ?? null;
state = {
  registered: true,
  listingId,
  manifestBaseUrl,
  endpoint: x402ServiceManifest.endpoint,
  paymentAddress: x402ServiceManifest.payment.address,
  chain: x402ServiceManifest.payment.chain,
  priceUsdc: x402ServiceManifest.pricing.base,
  registeredAt: new Date().toISOString(),
};
await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {
  mode: 0o600,
});
await chmod(statePath, 0o600);

console.log(
  JSON.stringify({
    registered: true,
    reused: false,
    listingId,
    manifestBaseUrl,
    endpoint: state.endpoint,
    exactBaseWallet: true,
  }),
);
