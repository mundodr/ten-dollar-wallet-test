import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiUrl = "https://api.datapoint.market";
const targetAddress = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const serviceSlug = "api-brief-acceptance-checklist";
const preferredProviderSlug = "ten-dollar-wallet-test";
const credentialsPath = path.resolve(".datapointmarket/credentials.json");
const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
const serviceState = JSON.parse(
  await readFile(path.resolve(".agentpaystore/credentials.json"), "utf8"),
);
const originUrl = serviceState.endpointUrl;

async function requestJson(route, options = {}, expected = [200]) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}${route}`, {
        ...options,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${credentials.automationKey}`,
          ...options.headers,
        },
        signal: AbortSignal.timeout(25_000),
      });
      const body = await response.json().catch(() => null);
      if (expected.includes(response.status)) return { response, body };
      lastError = new Error(
        `datapoint.market ${route} returned HTTP ${response.status}: ${body?.detail ?? body?.message ?? "unknown"}`,
      );
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError ?? new Error(`datapoint.market ${route} returned no response`);
}

const { body: currentProfile } = await requestJson("/dashboard/profile");
const currentSlug = currentProfile?.slug ?? currentProfile?.provider?.slug;
const { body: handleCheck } = await requestJson(
  `/dashboard/handle/check?slug=${preferredProviderSlug}`,
);
const usePreferredSlug =
  currentSlug === preferredProviderSlug || handleCheck?.available === true;
const profilePatch = {
  name: "The $10 Wallet Test",
  profile_type: "team",
  bio: "A transparent experiment offering small deterministic API QA services. Only independently verifiable Base settlement counts as revenue.",
  website_url: "https://mundodr.github.io/ten-dollar-wallet-test/",
  ...(usePreferredSlug ? { slug: preferredProviderSlug } : {}),
};
const { body: profile } = await requestJson(
  "/dashboard/profile",
  {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profilePatch),
  },
);
const providerSlug =
  profile?.slug ?? profile?.provider?.slug ?? currentSlug ?? credentials.provider?.slug;

const { body: endpointList } = await requestJson("/dashboard/endpoints");
const endpoints = Array.isArray(endpointList)
  ? endpointList
  : (endpointList?.endpoints ?? endpointList?.data ?? []);
let endpoint = endpoints.find((candidate) => candidate?.slug === serviceSlug);

if (!endpoint) {
  const payload = {
    name: "API Brief Acceptance Checklist",
    slug: serviceSlug,
    origin_url: originUrl,
    method: "POST",
    price_usd: "0.01",
    networks: ["eip155:8453"],
    pay_to: targetAddress,
    description:
      "Turn an English or Chinese API brief into deterministic JSON acceptance criteria and executable-style test scenarios.",
    public_listing: true,
    trial_safe: true,
    sample_request: {
      input:
        "Design POST /v1/widgets with name required, idempotency support, and a 201 JSON response.",
    },
    protection: "synthetic",
    free_trial_calls: 0,
    max_response_kb: 128,
  };
  const creation = await requestJson(
    "/dashboard/endpoints/api",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    [201],
  );
  endpoint = creation.body?.endpoint ?? creation.body;
}

if (!endpoint?.id) throw new Error("datapoint.market returned no endpoint id");
if (endpoint.status !== "active") {
  const publication = await requestJson(
    `/dashboard/endpoints/${endpoint.id}/publish`,
    { method: "POST" },
  );
  endpoint = publication.body?.endpoint ?? publication.body;
}

const relayUrl =
  endpoint?.relay_url ?? `${apiUrl}/r/${providerSlug}/${serviceSlug}`;
const publicUrl = `${apiUrl}/e/${providerSlug}/${serviceSlug}`;
const unpaidProbe = await fetch(relayUrl, {
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json" },
  body: JSON.stringify({ input: "Create acceptance checks for GET /health." }),
  signal: AbortSignal.timeout(25_000),
});
const unpaidBody = await unpaidProbe.json().catch(() => null);
if (unpaidProbe.status !== 402) {
  throw new Error(`datapoint.market unpaid relay returned HTTP ${unpaidProbe.status}`);
}

Object.assign(credentials, {
  provider: { ...(credentials.provider ?? {}), slug: providerSlug },
  endpointId: endpoint.id,
  endpointSlug: serviceSlug,
  endpointStatus: endpoint.status ?? "active",
  originUrl,
  relayUrl,
  publicUrl,
  payoutAddress: targetAddress,
  priceUsd: "0.01",
  network: "eip155:8453",
  publishedAt: new Date().toISOString(),
});
await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, "utf8");
await chmod(credentialsPath, 0o600);

console.log(
  JSON.stringify(
    {
      providerSlug,
      endpointId: endpoint.id,
      status: endpoint.status ?? "active",
      originHealth: serviceState.endpoint_ping ?? "ok",
      relayUrl,
      publicUrl,
      unpaidProbeStatus: unpaidProbe.status,
      offeredNetworks:
        unpaidBody?.accepts?.map((candidate) => candidate.network) ?? null,
      priceUsd: "0.01",
      payoutAddressMatches: targetAddress === credentials.payoutAddress,
    },
    null,
    2,
  ),
);
