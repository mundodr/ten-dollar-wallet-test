import fs from "node:fs/promises";
import path from "node:path";

const apiBase = "https://api.tools402.dev";
const upstreamUrl =
  "https://simply-technician-crowd-newton.trycloudflare.com/";
const targetPath = "/v1/ten-dollar-wallet-lab/api-brief-checklist";
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const credentialsPath = path.resolve(".tools402/credentials.json");
const registrationPath = path.resolve(".tools402/registration.json");

async function readJson(filename) {
  try {
    return JSON.parse(await fs.readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function requestJson(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(20_000),
      headers: {
        "user-agent": "ten-dollar-wallet-monitor/1.0",
        ...(options.headers ?? {}),
      },
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: null, error: error.message, body: null };
  }
}

const [credentials, registration] = await Promise.all([
  readJson(credentialsPath),
  readJson(registrationPath),
]);
if (
  credentials?.forwardingTarget &&
  credentials.forwardingTarget.toLowerCase() !== targetBaseWallet
) {
  throw new Error("tools402 forwarding target has drifted");
}

const [health, meta, upstream] = await Promise.all([
  requestJson(`${apiBase}/v1/_health`),
  requestJson(`${apiBase}/v1/_meta`),
  requestJson(upstreamUrl),
]);
const endpoints = Array.isArray(meta.body?.endpoints) ? meta.body.endpoints : [];
const listing = endpoints.find((item) => item?.path === targetPath) ?? null;
const exactListing = Boolean(
  listing &&
    credentials?.wallet &&
    listing.seller?.toLowerCase() === credentials.wallet.toLowerCase() &&
    Number(listing.atomic_price) === 10_000 &&
    listing.upstream_url === upstreamUrl,
);

let balance = null;
let settlements = null;
if (credentials?.wallet) {
  [balance, settlements] = await Promise.all([
    requestJson(`${apiBase}/v1/_seller/${credentials.wallet}/balance`),
    requestJson(`${apiBase}/v1/_seller/${credentials.wallet}/settlements`),
  ]);
}

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      platform: {
        health: { ok: health.ok, status: health.status, body: health.body },
        catalogAvailable: meta.ok,
        catalogStatus: meta.status,
        endpointCount: endpoints.length,
      },
      upstream: {
        ok: upstream.ok,
        status: upstream.status,
        jsonService: upstream.body?.service ?? null,
      },
      seller: {
        credentialsSaved: Boolean(credentials),
        registrationSaved: Boolean(registration),
        wallet: credentials?.wallet ?? null,
        forwardingTarget: targetBaseWallet,
      },
      listing: {
        listed: Boolean(listing),
        exactListing,
        path: targetPath,
        record: listing,
      },
      balance: balance?.ok ? balance.body : null,
      balanceError: balance && !balance.ok
        ? (balance.body?.error ?? balance.error ?? `HTTP ${balance.status}`)
        : null,
      settlements: settlements?.ok ? settlements.body : null,
      settlementError: settlements && !settlements.ok
        ? (settlements.body?.error ?? settlements.error ?? `HTTP ${settlements.status}`)
        : null,
      nextAction: !meta.ok
        ? "Wait for tools402 API recovery; do not attempt a raw registration while the catalog is unavailable."
        : !registration
          ? "Run scripts/register-tools402-service.mjs once."
          : !exactListing
            ? "Inspect the listing before serving or accepting settlement."
            : "Monitor genuine buyer calls and forward every real settlement to the disclosed Base target.",
      countingPolicy:
        "The listing, calls, pending balance, and intermediary settlements are not target-wallet funds. Never self-buy. Count only an independently verified transfer to the disclosed Base target.",
    },
    null,
    2,
  ),
);

if (registration && listing && !exactListing) {
  throw new Error("tools402 listing terms do not match the saved seller state");
}
