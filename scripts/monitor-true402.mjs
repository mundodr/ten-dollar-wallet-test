import { readFile } from "node:fs/promises";
import path from "node:path";
import { x402ServiceManifest } from "./agentictrade-service-api.mjs";

const registryUrl = "https://true402.dev/api/v1/services";
const statePath = path.resolve(".true402/listing.json");
let state;
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }
  throw lastError;
}

if (!state) {
  const manifestBaseUrl = "https://begins-greatly-badge-dealers.trycloudflare.com";
  const manifestResponse = await fetchWithRetry(
    new URL("/.well-known/x402-service.json", manifestBaseUrl),
  );
  const liveManifest = await manifestResponse.json().catch(() => null);
  const exactManifest =
    JSON.stringify(liveManifest) === JSON.stringify(x402ServiceManifest);
  if (!manifestResponse.ok || !exactManifest) {
    throw new Error("The public true402 manifest is unavailable or has drifted");
  }
  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        registered: false,
        listed: false,
        manifestOnline: true,
        exactManifest,
        endpoint: liveManifest.endpoint,
        exactBaseWallet:
          liveManifest.payment?.address?.toLowerCase() ===
          "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18",
        chain: liveManifest.payment?.chain,
        priceUsdc: liveManifest.pricing?.base,
        nextAction:
          "Retry scripts/register-true402-service.mjs; the registry TLS connection has not completed yet.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const [manifestResponse, catalogResponse] = await Promise.all([
  fetchWithRetry(
    new URL("/.well-known/x402-service.json", state.manifestBaseUrl),
  ),
  fetchWithRetry(registryUrl),
]);
const liveManifest = await manifestResponse.json().catch(() => null);
const catalogBody = await catalogResponse.json().catch(() => null);

if (!manifestResponse.ok || !catalogResponse.ok) {
  throw new Error(
    `true402 monitor failed (manifest ${manifestResponse.status}, catalog ${catalogResponse.status})`,
  );
}

const services = Array.isArray(catalogBody)
  ? catalogBody
  : Array.isArray(catalogBody?.services)
    ? catalogBody.services
    : Array.isArray(catalogBody?.items)
      ? catalogBody.items
      : [];
const listing = services.find(
  (service) =>
    (state.listingId && service.id === state.listingId) ||
    service.url === state.manifestBaseUrl ||
    service.base_url === state.manifestBaseUrl ||
    service.endpoint === state.endpoint ||
    service.manifest?.endpoint === state.endpoint,
);

const exactManifest =
  JSON.stringify(liveManifest) === JSON.stringify(x402ServiceManifest);
if (!exactManifest) throw new Error("The public true402 manifest has drifted");

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      listingId: state.listingId,
      listed: Boolean(listing),
      manifestOnline: true,
      exactManifest,
      endpoint: state.endpoint,
      exactBaseWallet:
        liveManifest.payment?.address?.toLowerCase() ===
        "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18",
      chain: liveManifest.payment?.chain,
      priceUsdc: liveManifest.pricing?.base,
      note:
        "true402 is a free discovery registry and does not observe third-party settlement; only a matching target-chain transfer counts.",
    },
    null,
    2,
  ),
);
