const resourceUrl =
  "https://simply-technician-crowd-newton.trycloudflare.com/x402";
const targetAddress = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const cdpBase = "https://api.cdp.coinbase.com/platform/v2/x402";

async function parseResponse(response, label) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok && response.status !== 402) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
  return body;
}

const liveResponse = await fetch(resourceUrl, {
  method: "POST",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    input: "POST /v1/orders must return HTTP 201 and reject a missing id.",
  }),
  signal: AbortSignal.timeout(30_000),
});
const liveChallenge = await parseResponse(liveResponse, "public x402 route");
const encodedChallenge = liveResponse.headers.get("payment-required");
let headerChallenge = null;
try {
  headerChallenge = JSON.parse(
    Buffer.from(encodedChallenge ?? "", "base64").toString("utf8"),
  );
} catch {
  throw new Error("public x402 route returned no decodable PAYMENT-REQUIRED header");
}

const requirement = liveChallenge?.accepts?.find(
  (candidate) =>
    candidate?.scheme === "exact" &&
    candidate?.network === "eip155:8453" &&
    candidate?.amount === "10000" &&
    candidate?.payTo?.toLowerCase() === targetAddress &&
    candidate?.asset?.toLowerCase() === baseUsdc.toLowerCase(),
);
const bazaar = liveChallenge?.extensions?.bazaar;
const liveValid =
  liveResponse.status === 402 &&
  JSON.stringify(liveChallenge) === JSON.stringify(headerChallenge) &&
  liveChallenge?.resource?.url === resourceUrl &&
  liveChallenge?.resource?.serviceName === "Acceptance Checklist API" &&
  bazaar?.info?.input?.type === "http" &&
  bazaar?.info?.input?.method === "POST" &&
  bazaar?.info?.input?.bodyType === "json" &&
  typeof bazaar?.info?.input?.body?.input === "string" &&
  bazaar?.info?.output?.type === "json" &&
  bazaar?.schema?.$schema ===
    "https://json-schema.org/draft/2020-12/schema" &&
  requirement;

if (!liveValid) {
  throw new Error("public x402 Bazaar challenge no longer matches safe Base terms");
}

const validationResponse = await fetch(`${cdpBase}/validate`, {
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json" },
  body: JSON.stringify({ resource: resourceUrl, method: "POST" }),
  signal: AbortSignal.timeout(30_000),
});
const validation = await parseResponse(
  validationResponse,
  "CDP x402 validation",
);
const requiredFailures = (validation?.preflight ?? []).filter(
  (check) => check?.severity === "required" && check?.passed !== true,
);
const validationAccepted =
  validationResponse.ok &&
  validation?.valid === true &&
  validation?.simulation?.outcome === "accepted" &&
  requiredFailures.length === 0;
if (!validationAccepted) {
  throw new Error("CDP no longer accepts the public x402 Bazaar metadata");
}

const merchantUrl = new URL(`${cdpBase}/discovery/merchant`);
merchantUrl.searchParams.set("payTo", targetAddress);
merchantUrl.searchParams.set("limit", "100");
merchantUrl.searchParams.set("offset", "0");
const merchantResponse = await fetch(merchantUrl, {
  headers: { Accept: "application/json" },
  signal: AbortSignal.timeout(30_000),
});
const merchant = await parseResponse(
  merchantResponse,
  "CDP Bazaar merchant discovery",
);
const resources = Array.isArray(merchant?.resources) ? merchant.resources : [];
const listing = resources.find(
  (candidate) => candidate?.resource === resourceUrl,
);

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      live: {
        valid: true,
        resource: liveChallenge.resource,
        payment: requirement,
        bazaarInput: bazaar.info.input,
      },
      validation: {
        valid: validation.valid,
        simulationOutcome: validation.simulation?.outcome ?? null,
        requiredChecks: (validation.preflight ?? []).filter(
          (check) => check?.severity === "required",
        ).length,
        requiredFailures,
      },
      discovery: {
        indexed: Boolean(listing),
        merchantResourceCount: resources.length,
        listing: listing ?? null,
      },
      paymentAttempted: false,
      countedMainnetValueUsd: 0,
    },
    null,
    2,
  ),
);
