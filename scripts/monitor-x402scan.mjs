const originId = "03644fd6-82ea-4544-ad1f-0c75a4c50029";
const resourceId = "7751e88b-c160-48f7-a303-d97cfed6ef9f";
const resourceUrl =
  "https://payanagent.com/x402/kh7ezjzt4etk8x1s908z7wngqn8d89hx";
const directoryUrl = `https://www.x402scan.com/server/${originId}`;
const targetAddress = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const input = encodeURIComponent(
  JSON.stringify({ json: { originIds: [originId] } }),
);
const indexApi =
  `https://www.x402scan.com/api/trpc/public.origins.list.withResources?input=${input}`;

const [indexResponse, liveResponse] = await Promise.all([
  fetch(indexApi, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  }),
  fetch(resourceUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  }),
]);

const indexBody = await indexResponse.json().catch(() => null);
const liveBody = await liveResponse.json().catch(() => null);
let liveChallenge = null;
try {
  liveChallenge = JSON.parse(
    Buffer.from(liveResponse.headers.get("payment-required") ?? "", "base64").toString(
      "utf8",
    ),
  );
} catch {
  throw new Error("live x402 route returned no decodable PAYMENT-REQUIRED header");
}
if (!indexResponse.ok) {
  throw new Error(`x402scan index returned HTTP ${indexResponse.status}`);
}

const origin = indexBody?.result?.data?.json?.[0];
const listing = origin?.resources?.find(
  (candidate) => candidate?.id === resourceId && candidate?.resource === resourceUrl,
);
const indexedPayment = listing?.accepts?.find(
  (candidate) =>
    candidate?.scheme === "exact" &&
    candidate?.network === "base" &&
    candidate?.maxAmountRequired === "10000" &&
    candidate?.asset?.toLowerCase() === baseUsdc.toLowerCase() &&
    candidate?.payTo?.toLowerCase() === targetAddress,
);
const livePayment = liveChallenge?.accepts?.find(
  (candidate) =>
    candidate?.scheme === "exact" &&
    candidate?.network === "eip155:8453" &&
    candidate?.amount === "10000" &&
    candidate?.asset?.toLowerCase() === baseUsdc.toLowerCase() &&
    candidate?.payTo?.toLowerCase() === targetAddress,
);
const listingExact =
  origin?.id === originId &&
  origin?.origin === "https://payanagent.com" &&
  listing?.x402Version === 2 &&
  listing?.success === true &&
  Boolean(indexedPayment);
const challengeExact =
  liveResponse.status === 402 &&
  liveBody?.priceUsd === 0.01 &&
  liveChallenge?.x402Version === 2 &&
  liveChallenge?.resource?.url === resourceUrl &&
  Boolean(livePayment);

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      directoryUrl,
      originId,
      resourceId,
      resourceUrl,
      listingExact,
      challengeExact,
      indexedAt: listing?.lastUpdated ?? null,
      indexedPayment: indexedPayment
        ? {
            scheme: indexedPayment.scheme,
            network: indexedPayment.network,
            amount: indexedPayment.maxAmountRequired,
            asset: indexedPayment.asset,
            payTo: indexedPayment.payTo,
          }
        : null,
      livePayment: livePayment ?? null,
      x402scanVerification: {
        verified: indexedPayment?.verified ?? null,
        verifiedAt: indexedPayment?.verifiedAt ?? null,
      },
      serverWideActivity: {
        transactions: origin?.totalTransactions ?? null,
        volume: origin?.totalVolume ?? null,
        uniqueBuyers: origin?.uniqueBuyers ?? null,
      },
      paymentAttempted: false,
      countedMainnetValueUsd: 0,
      countingPolicy:
        "Registration, a successful probe, verification, and server-wide activity are discovery signals only. Never self-buy. Count only an independently verified Base transfer to the disclosed target.",
    },
    null,
    2,
  ),
);

if (!listingExact || !challengeExact) {
  throw new Error("x402scan listing or live x402 terms do not match the target");
}
