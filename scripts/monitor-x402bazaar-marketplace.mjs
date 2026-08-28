import fs from "node:fs/promises";
import path from "node:path";

const apiBase = "https://x402-api.onrender.com";
const serviceUrl =
  "https://begins-greatly-badge-dealers.trycloudflare.com/x402";
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const registrationPath = path.resolve(".x402bazaar/registration.json");

async function readJson(filename) {
  try {
    return JSON.parse(await fs.readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function requestJson(url) {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "ten-dollar-wallet-monitor/1.0" },
      signal: AbortSignal.timeout(20_000),
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

const registration = await readJson(registrationPath);
const [health, stats, catalog] = await Promise.all([
  requestJson(`${apiBase}/health`),
  requestJson(`${apiBase}/api/public-stats`),
  requestJson(`${apiBase}/api/services`),
]);

const services = catalog.ok
  ? Array.isArray(catalog.body)
    ? catalog.body
    : (catalog.body?.data ?? catalog.body?.services ?? [])
  : [];
const savedId = registration?.service?.id ?? registration?.service?.service_id;
const listedService = services.find(
  (service) => service?.id === savedId || service?.url === serviceUrl,
);
const settlementWallet =
  registration?.settlementWallet ?? registration?.signerAddress ?? null;
const exactListing = Boolean(
  listedService &&
    listedService.url === serviceUrl &&
    Number(listedService.price_usdc ?? listedService.price) === 0.01 &&
    settlementWallet &&
    listedService.owner_address?.toLowerCase() === settlementWallet.toLowerCase(),
);

let analytics = null;
if (settlementWallet) {
  analytics = await requestJson(
    `${apiBase}/api/provider/${encodeURIComponent(settlementWallet)}/analytics`,
  );
}

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      health: {
        ok: health.ok,
        status: health.status,
        network: health.body?.network ?? null,
        version: health.body?.version ?? null,
      },
      publicStats: stats.body,
      serviceDatabase: {
        available: catalog.ok,
        status: catalog.status,
        error: catalog.ok
          ? null
          : (catalog.body?.error ?? catalog.error ?? "unknown"),
      },
      registration: {
        saved: Boolean(registration),
        serviceId: savedId ?? null,
        listed: Boolean(listedService),
        exactListing,
        serviceUrl,
        settlementWallet,
        forwardingTarget: targetBaseWallet,
      },
      analytics: analytics
        ? {
            available: analytics.ok,
            status: analytics.status,
            body: analytics.ok ? analytics.body : null,
            error: analytics.ok
              ? null
              : (analytics.body?.error ?? analytics.error ?? "unknown"),
          }
        : null,
      nextAction: !catalog.ok
        ? "Wait for the marketplace service database to recover, then retry the free registration once."
        : !registration
          ? "Run scripts/register-x402bazaar.mjs once."
          : !exactListing
            ? "Inspect the saved registration before accepting any order or settlement."
            : "Monitor genuine third-party calls and forward any real settlement to the disclosed Base target.",
      countingPolicy:
        "Registration, marketplace analytics, calls, and intermediary balances are not target-wallet funds. Never self-buy. Count only an independently verified Base transfer to the disclosed target.",
    },
    null,
    2,
  ),
);

if (registration && listedService && !exactListing) {
  throw new Error("x402Bazaar listing terms do not match the saved settlement wallet");
}
