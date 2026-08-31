import { readFile } from "node:fs/promises";
import path from "node:path";

const apiUrl = "https://api.nohumans.directory";
const listingId = "2a391125-e4b";
const endpointUrl =
  "https://payanagent.com/x402/kh7ezjzt4etk8x1s908z7wngqn8d89hx";
const targetPayTo = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const codeReviewEndpoint =
  "https://payanagent.com/x402/kh7csa6y1atvzs35bneg89xx0d8dhm2d";
const codeReviewStatePath = path.resolve(
  ".nohumans/code-review-listing-state.json",
);

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

const codeReviewState = await readFile(codeReviewStatePath, "utf8")
  .then(JSON.parse)
  .catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
let codeReviewListing = null;
if (codeReviewState?.id) {
  const [directoryListing, liveResponse] = await Promise.all([
    fetchJson(
      `${apiUrl}/v1/listings/${encodeURIComponent(codeReviewState.id)}`,
    ),
    fetch(codeReviewEndpoint, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ code: "print('hello')" }),
      signal: AbortSignal.timeout(20_000),
    }),
  ]);
  const encodedChallenge =
    liveResponse.headers.get("payment-required") ??
    liveResponse.headers.get("x-payment-required");
  let challenge = null;
  try {
    challenge = JSON.parse(
      Buffer.from(encodedChallenge ?? "", "base64").toString("utf8"),
    );
  } catch {
    challenge = await liveResponse.json().catch(() => null);
  }
  const payment = challenge?.accepts?.[0];
  const exactDirectoryListing =
    directoryListing?.id === codeReviewState.id &&
    directoryListing?.name === "Deterministic Python Security Review (One File)" &&
    directoryListing?.endpoint_url === codeReviewEndpoint &&
    directoryListing?.category === "infra.security" &&
    Number(directoryListing?.price_amount) === 5 &&
    directoryListing?.price_currency === "USDC" &&
    directoryListing?.chains?.includes("base");
  const exactLiveTerms =
    liveResponse.status === 402 &&
    challenge?.x402Version === 2 &&
    challenge?.resource?.url === codeReviewEndpoint &&
    payment?.scheme === "exact" &&
    payment?.network === "eip155:8453" &&
    payment?.amount === "5000000" &&
    String(payment?.payTo).toLowerCase() === targetPayTo &&
    String(payment?.asset).toLowerCase() === baseUsdc.toLowerCase();
  const observedCodeReviewPayTo =
    directoryListing?.obs_pay_to ?? directoryListing?.observed?.pay_to ?? null;
  const observedCodeReviewNetwork =
    directoryListing?.obs_network ?? directoryListing?.observed?.network ?? null;
  const observedCodeReviewAmount =
    directoryListing?.amount_atomic ??
    directoryListing?.observed?.amount_atomic ??
    null;
  const observedCodeReviewTermsMatch =
    observedCodeReviewPayTo === null ||
    (String(observedCodeReviewPayTo).toLowerCase() === targetPayTo &&
      ["base", "eip155:8453"].includes(observedCodeReviewNetwork) &&
      String(observedCodeReviewAmount) === "5000000");
  codeReviewListing = {
    listingId: codeReviewState.id,
    publicUrl: `${apiUrl}/v1/listings/${codeReviewState.id}`,
    status: directoryListing?.status ?? null,
    exactListing: exactDirectoryListing,
    exactLiveTerms,
    observedTermsMatch: observedCodeReviewTermsMatch,
    score: directoryListing?.score ?? null,
    probeCount: directoryListing?.probe_count ?? null,
    paidVerified: directoryListing?.paid_verified ?? false,
    evidenceTier: directoryListing?.evidence_tier ?? null,
    onchainTransactionCount30d:
      directoryListing?.onchain_tx_count_30d ?? null,
    onchainUniquePayers30d:
      directoryListing?.onchain_unique_payers_30d ?? null,
    onchainVolumeUsd30d: directoryListing?.onchain_volume_usd_30d ?? null,
  };
}

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
      codeReviewListing,
      countingPolicy:
        "Directory listings, probes, and counters are discovery evidence only. Never self-buy. Count only an independently verified Base-mainnet target receipt.",
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
if (
  codeReviewListing &&
  (!codeReviewListing.exactListing ||
    !codeReviewListing.exactLiveTerms ||
    !codeReviewListing.observedTermsMatch)
) {
  throw new Error("nohumans.directory code-review listing drifted");
}
