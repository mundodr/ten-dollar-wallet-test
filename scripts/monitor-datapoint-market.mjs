import { readFile } from "node:fs/promises";
import path from "node:path";

const apiUrl = "https://api.datapoint.market";
const targetAddress = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const officialBaseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const credentials = JSON.parse(
  await readFile(path.resolve(".datapointmarket/credentials.json"), "utf8"),
);

async function fetchJson(url, options = {}, expectedStatus = 200) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { Accept: "application/json", ...options.headers },
        signal: AbortSignal.timeout(25_000),
      });
      const body = await response.json().catch(() => null);
      if (response.status === expectedStatus) return { response, body };
      lastError = new Error(
        `datapoint.market returned HTTP ${response.status} for ${new URL(url).pathname}`,
      );
    } catch (error) {
      lastError = error;
    }
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError ?? new Error("datapoint.market returned no response");
}

const authHeaders = { Authorization: `Bearer ${credentials.automationKey}` };
const [detailResult, statsResult, paymentsResult, publicResult, unpaidResult] =
  await Promise.all([
    fetchJson(`${apiUrl}/dashboard/endpoints/${credentials.endpointId}`, {
      headers: authHeaders,
    }),
    fetchJson(`${apiUrl}/dashboard/stats`, { headers: authHeaders }),
    fetchJson(`${apiUrl}/dashboard/payments`, { headers: authHeaders }),
    fetchJson(credentials.publicUrl),
    fetchJson(
      credentials.relayUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "Create acceptance checks for GET /health." }),
      },
      402,
    ),
  ]);

const endpoint = detailResult.body;
const totals = statsResult.body?.totals ?? {};
const payments = paymentsResult.body?.payments ?? [];
const publicListing = publicResult.body;
const paymentTerms = unpaidResult.body?.accepts?.[0];
const exactEndpoint =
  endpoint?.id === credentials.endpointId &&
  endpoint?.slug === credentials.endpointSlug &&
  endpoint?.status === "active" &&
  endpoint?.public_listing === true &&
  endpoint?.free === false &&
  endpoint?.environment === "live" &&
  endpoint?.origin_url === credentials.originUrl &&
  endpoint?.relay_url === credentials.relayUrl &&
  Number(endpoint?.price_usd) === 0.01 &&
  endpoint?.networks?.includes("eip155:8453");
const exactPaymentTerms =
  paymentTerms?.scheme === "exact" &&
  paymentTerms?.network === "eip155:8453" &&
  paymentTerms?.asset?.toLowerCase() === officialBaseUsdc.toLowerCase() &&
  paymentTerms?.maxAmountRequired === "15000" &&
  paymentTerms?.extra?.providerAmount === "10000" &&
  paymentTerms?.extra?.feeAmount === "5000" &&
  paymentTerms?.extra?.providerWallet?.toLowerCase() === targetAddress;
const exactPublicListing =
  publicListing?.relay_url === credentials.relayUrl &&
  publicListing?.provider?.slug === credentials.provider?.slug &&
  Number(publicListing?.price_usd) === 0.01 &&
  publicListing?.networks?.includes("eip155:8453");

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      endpointId: credentials.endpointId,
      publicUrl: credentials.publicUrl,
      relayUrl: credentials.relayUrl,
      exactEndpoint,
      exactPublicListing,
      status: endpoint?.status ?? null,
      verifyStatus: endpoint?.verify_status ?? null,
      hasSample: Boolean(endpoint?.output_schema && endpoint?.example),
      unpaidProbeStatus: unpaidResult.response.status,
      exactPaymentTerms,
      paymentTerms: {
        network: paymentTerms?.network ?? null,
        asset: paymentTerms?.asset ?? null,
        buyerTotalBaseUnits: paymentTerms?.maxAmountRequired ?? null,
        providerAmountBaseUnits: paymentTerms?.extra?.providerAmount ?? null,
        feeAmountBaseUnits: paymentTerms?.extra?.feeAmount ?? null,
        providerWallet: paymentTerms?.extra?.providerWallet ?? null,
      },
      totals: {
        callsSettled: totals.calls_settled ?? null,
        callsFailed: totals.calls_failed ?? null,
        revenueUsd: totals.revenue_usd ?? null,
        calls24h: totals.calls_24h ?? null,
        calls7d: totals.calls_7d ?? null,
      },
      payments: payments.map((payment) => ({
        id: payment.id ?? null,
        status: payment.status ?? null,
        network: payment.network ?? null,
        providerAmount: payment.provider_amount ?? payment.amount ?? null,
        txHash: payment.tx_hash ?? null,
        createdAt: payment.created_at ?? null,
      })),
    },
    null,
    2,
  ),
);

if (!exactEndpoint || !exactPublicListing || !exactPaymentTerms) {
  throw new Error("datapoint.market service no longer matches the intended terms");
}
