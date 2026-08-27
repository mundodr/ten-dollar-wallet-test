const endpointUrl =
  "https://simply-technician-crowd-newton.trycloudflare.com/x402";
const apiBase = "https://api.x402dash.com";
const targetAddress = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const [challengeResponse, detailResponse] = await Promise.all([
  fetch(endpointUrl, { signal: AbortSignal.timeout(30_000) }),
  fetch(
    `${apiBase}/v1/liveness?endpoint=${encodeURIComponent(endpointUrl)}`,
    { signal: AbortSignal.timeout(30_000) },
  ),
]);
const challenge = await challengeResponse.json().catch(() => null);
const detail = await detailResponse.json().catch(() => null);
const payment = challenge?.accepts?.[0];
const indexedPayment = detail?.accepts?.[0];
const challengeExact =
  challengeResponse.status === 402 &&
  challenge?.x402Version === 2 &&
  payment?.network === "eip155:8453" &&
  payment?.amount === "10000" &&
  payment?.asset?.toLowerCase() === baseUsdc.toLowerCase() &&
  payment?.payTo?.toLowerCase() === targetAddress;
const indexExact =
  detailResponse.ok &&
  detail?.url === endpointUrl &&
  detail?.price_usd === 0.01 &&
  detail?.network === "eip155:8453" &&
  detail?.pay_to?.toLowerCase() === targetAddress &&
  indexedPayment?.asset?.toLowerCase() === baseUsdc.toLowerCase() &&
  indexedPayment?.amount === "10000";

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      endpointId: detail?.id ?? null,
      endpointUrl,
      registered: detailResponse.ok,
      challengeExact,
      indexExact,
      priceUsd: detail?.price_usd ?? null,
      network: detail?.network ?? null,
      payTo: detail?.pay_to ?? null,
      livenessScore: detail?.liveness_score ?? null,
      livenessConfidence: detail?.liveness_confidence ?? null,
      reachabilityStatus: detail?.reachability_status ?? null,
      integrationReadiness: detail?.integration_readiness ?? null,
      checkCount: detail?.check_count ?? null,
      aliveCount: detail?.alive_count ?? null,
      onchainTxCount30d: detail?.onchain_tx_count_30d ?? null,
      onchainUniquePayers30d: detail?.onchain_unique_payers_30d ?? null,
      onchainLastTxAt: detail?.onchain_last_tx_at ?? null,
      countingPolicy:
        "Directory verification and liveness are discovery evidence only. Count only a matching Base transfer at the disclosed target address.",
    },
    null,
    2,
  ),
);

if (!challengeExact || !indexExact) {
  throw new Error("x402dash listing or live x402 terms do not match the target");
}
