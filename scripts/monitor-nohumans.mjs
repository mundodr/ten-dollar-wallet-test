const apiUrl = "https://api.nohumans.directory";
const listingId = "2a391125-e4b";
const endpointUrl =
  "https://payanagent.com/x402/kh7ezjzt4etk8x1s908z7wngqn8d89hx";
const targetPayTo = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) return body;
      lastError = new Error(
        `nohumans.directory returned HTTP ${response.status}`,
      );
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError ?? new Error("nohumans.directory returned no response");
}

const listing = await fetchJson(`${apiUrl}/v1/listings/${listingId}`);
const exactListing =
  listing?.id === listingId &&
  listing?.endpoint_url === endpointUrl &&
  listing?.category === "infra.validation" &&
  Number(listing?.price_amount) === 0.01 &&
  listing?.price_currency === "USDC" &&
  listing?.chains?.includes("base");

const observedPayTo = listing?.obs_pay_to ?? listing?.observed?.pay_to ?? null;
const observedNetwork =
  listing?.obs_network ?? listing?.observed?.network ?? null;
const observedAmount =
  listing?.amount_atomic ?? listing?.observed?.amount_atomic ?? null;
const observedTermsMatch =
  observedPayTo === null ||
  (observedPayTo.toLowerCase() === targetPayTo &&
    ["base", "eip155:8453"].includes(observedNetwork) &&
    String(observedAmount) === "10000");

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      listingId,
      publicUrl: `${apiUrl}/v1/listings/${listingId}`,
      exactListing,
      status: listing?.status ?? null,
      score: listing?.score ?? null,
      probeCount: listing?.probe_count ?? null,
      lastProbedAt: listing?.last_probed_at ?? null,
      observedNetwork,
      observedPayTo,
      observedAmount,
      observedTermsMatch,
      paidVerified: listing?.paid_verified ?? false,
      evidenceTier: listing?.evidence_tier ?? null,
      onchainTransactionCount30d: listing?.onchain_tx_count_30d ?? null,
      onchainUniquePayers30d: listing?.onchain_unique_payers_30d ?? null,
      onchainVolumeUsd30d: listing?.onchain_volume_usd_30d ?? null,
    },
    null,
    2,
  ),
);

if (!exactListing) {
  throw new Error("nohumans.directory listing no longer matches the intended service");
}
if (!observedTermsMatch) {
  throw new Error("nohumans.directory observed unexpected x402 payment terms");
}
