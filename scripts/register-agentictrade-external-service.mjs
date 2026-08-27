import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://agentictrade.io";
const credentialsPath = path.resolve(".agentictrade/credentials.json");
const statePath = path.resolve(".agentictrade/external-service-state.json");
const responsePath = path.resolve(".agentictrade/external-service-response.json");
const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
const providerToken = credentials.walletProviderToken;
const endpoint = process.env.AGENTICTRADE_SERVICE_URL;
const serviceName = "Deterministic API Brief Acceptance Checklist";

if (!providerToken) throw new Error("Wallet-bound AgenticTrade provider token is unavailable");
if (!endpoint) throw new Error("AGENTICTRADE_SERVICE_URL is required");
const endpointUrl = new URL(endpoint);
if (endpointUrl.protocol !== "https:" || !endpointUrl.hostname.endsWith(".trycloudflare.com")) {
  throw new Error("Service URL must be an HTTPS trycloudflare.com endpoint");
}

async function api(route, options = {}) {
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(new URL(route, baseUrl), {
        ...options,
        headers: {
          Authorization: `Bearer ${providerToken}`,
          Accept: "application/json",
          ...options.headers,
        },
      });
      if (response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  if (!response) throw lastError ?? new Error(`No response from ${route}`);
  const body = await response.json().catch(() => null);
  return { response, body };
}

const health = await fetch(new URL("/health", endpointUrl));
const healthBody = await health.json().catch(() => null);
if (!health.ok || healthBody?.status !== "ok") {
  throw new Error(`Public service health check failed (${health.status})`);
}

let contact = await api("/api/v1/provider-contact");
if (!contact.response.ok || !contact.body?.email) {
  contact = await api("/api/v1/provider-contact", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: credentials.email, preferred_locale: "en" }),
  });
  if (!contact.response.ok) {
    throw new Error(`AgenticTrade provider contact registration failed (${contact.response.status})`);
  }
}

let state = null;
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

let service = null;
if (state?.serviceId) {
  const current = await api(`/api/v1/services/${encodeURIComponent(state.serviceId)}`);
  if (current.response.ok) service = current.body;
}

let created = false;
if (!service) {
  const creation = await api("/api/v1/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: serviceName,
      description:
        "Deterministically turn an English or Chinese API feature brief or bug report into strict JSON acceptance criteria, edge cases, open questions, and six executable-style test scenarios. No submitted data is retained.",
      endpoint: endpointUrl.origin,
      price_per_call: "0.01",
      category: "devtools",
      tags: ["api", "testing", "json", "acceptance-criteria", "deterministic", "no-retention"],
      payment_method: "x402",
      free_tier_calls: 1,
    }),
  });
  await writeFile(responsePath, `${JSON.stringify(creation.body, null, 2)}\n`, { mode: 0o600 });
  await chmod(responsePath, 0o600);
  if (!creation.response.ok) {
    throw new Error(
      `AgenticTrade external service registration failed (${creation.response.status}): ${creation.body?.error ?? creation.body?.detail ?? "unknown"}`,
    );
  }
  service = creation.body;
  created = true;
} else if (service.endpoint !== endpointUrl.origin) {
  const update = await api(`/api/v1/services/${encodeURIComponent(state.serviceId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: endpointUrl.origin, status: "active" }),
  });
  if (!update.response.ok) {
    throw new Error(`AgenticTrade service endpoint update failed (${update.response.status})`);
  }
  service = update.body;
}

const serviceId = service.id ?? service.service_id;
const test = await api(`/api/v1/provider/services/${encodeURIComponent(serviceId)}/test`, {
  method: "POST",
});
await writeFile(
  statePath,
  `${JSON.stringify(
    {
      serviceId,
      name: service.name,
      endpoint: endpointUrl.origin,
      status: service.status,
      pricePerCall: service.pricing?.price_per_call ?? service.price_per_call,
      testStatus: test.response.status,
      testSucceeded: test.response.ok && test.body?.success !== false,
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
await chmod(statePath, 0o600);

console.log(
  JSON.stringify({
    created,
    serviceId,
    status: service.status,
    endpointConfigured: service.endpoint === endpointUrl.origin,
    pricePerCall: service.pricing?.price_per_call ?? service.price_per_call,
    ownerTestStatus: test.response.status,
    ownerTestSucceeded: test.response.ok && test.body?.success !== false,
  }),
);
