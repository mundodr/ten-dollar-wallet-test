const apiUrl = "https://api.catalog.paysponge.com/api/services";
const serviceName = "API Brief Acceptance Checklist";
const endpointUrl =
  "https://payanagent.com/x402/kh7ezjzt4etk8x1s908z7wngqn8d89hx";

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
      lastError = new Error(`Sponge Catalog returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError ?? new Error("Sponge Catalog returned no response");
}

const catalog = await fetchJson(apiUrl);
const services = Array.isArray(catalog?.data) ? catalog.data : [];
const service = services.find((candidate) => candidate?.name === serviceName);
const x402Config = service?.paymentsProtocolConfig?.find(
  (candidate) => candidate?.protocol === "x402",
);
const exactListing =
  service === undefined ||
  (x402Config?.baseUrl === endpointUrl &&
    x402Config?.networks?.some((network) =>
      ["base", "eip155:8453"].includes(network),
    ));

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      requestSubmittedAt: "2026-08-27T12:48:00.000Z",
      catalogUrl: "https://catalog.paysponge.com/",
      listed: Boolean(service),
      exactListing,
      serviceId: service?.id ?? null,
      slug: service?.slug ?? null,
      endpointCount: service?.endpointCount ?? null,
      observedBaseUrl: x402Config?.baseUrl ?? null,
      observedNetworks: x402Config?.networks ?? null,
    },
    null,
    2,
  ),
);

if (!exactListing) {
  throw new Error("Sponge Catalog published unexpected service metadata");
}
