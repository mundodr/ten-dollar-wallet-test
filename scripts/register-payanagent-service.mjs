import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://payanagent.com";
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const privateDir = path.resolve(".payanagent");
const credentialsPath = path.join(privateDir, "credentials.json");
const statePath = path.join(privateDir, "service-state.json");
const endpoint = process.env.PAYANAGENT_SERVICE_URL;

if (!endpoint) throw new Error("PAYANAGENT_SERVICE_URL is required");
const endpointUrl = new URL(endpoint);
if (endpointUrl.protocol !== "https:" || !endpointUrl.hostname.endsWith(".trycloudflare.com")) {
  throw new Error("Service URL must be an HTTPS trycloudflare.com endpoint");
}

async function request(route, options = {}, token = null) {
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(new URL(route, baseUrl), {
        ...options,
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      });
      if (response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  if (!response) throw lastError ?? new Error(`No PayanAgent response from ${route}`);
  const body = await response.json().catch(() => null);
  return { response, body };
}

const health = await fetch(new URL("/health", endpointUrl));
const healthBody = await health.json().catch(() => null);
if (!health.ok || healthBody?.status !== "ok") {
  throw new Error(`Public service health check failed (${health.status})`);
}

await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
let credentials = null;
try {
  credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

let registered = false;
if (!credentials?.apiKey || !credentials?.agentId) {
  const registration = await request("/api/v1/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "ten-dollar-wallet-worker",
      description:
        "Open-source deterministic API testing tools with public source, reproducible tests, and direct Base USDC settlement.",
      walletAddress: targetBaseWallet,
      chain: "base",
      tags: ["api", "testing", "json", "open-source"],
      providerType: "api",
      discoverySource: "web_search",
    }),
  });
  if (!registration.response.ok || !registration.body?.apiKey || !registration.body?.agentId) {
    throw new Error(
      `PayanAgent registration failed (${registration.response.status}): ${registration.body?.error ?? "unknown"}`,
    );
  }
  credentials = {
    agentId: registration.body.agentId,
    apiKey: registration.body.apiKey,
    walletAddress: targetBaseWallet,
    registeredAt: new Date().toISOString(),
  };
  await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(credentialsPath, 0o600);
  registered = true;
}

const profile = await request(`/api/v1/agents/${encodeURIComponent(credentials.agentId)}`);
if (!profile.response.ok) throw new Error(`PayanAgent profile check failed (${profile.response.status})`);
const profileWallet =
  profile.body?.walletAddress ?? profile.body?.wallet_address ?? profile.body?.agent?.walletAddress;
if (profileWallet?.toLowerCase() !== targetBaseWallet.toLowerCase()) {
  throw new Error("PayanAgent profile Base wallet does not match the target address");
}

let state = null;
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

let offer = null;
if (state?.offerId) {
  const current = await request(`/api/v1/offers/${encodeURIComponent(state.offerId)}`);
  if (current.response.ok) offer = current.body?.offer ?? current.body;
} else {
  const search = await request(
    `/api/v1/offers?q=${encodeURIComponent("Deterministic API Brief Acceptance Checklist")}&sort=new&limit=20`,
  );
  offer = (search.body?.offers ?? []).find(
    (candidate) =>
      candidate.title === "Deterministic API Brief Acceptance Checklist" &&
      candidate.sellerId === credentials.agentId,
  );
}

let created = false;
const expectedEndpoint = new URL("/invoke", endpointUrl).toString();
if (!offer) {
  const creation = await request(
    "/api/v1/offers",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Deterministic API Brief Acceptance Checklist",
        description:
          "Turn an English or Chinese API feature brief or bug report into strict JSON acceptance criteria, assumptions, edge cases, open questions, and six executable-style test scenarios. No submitted data is retained.",
        category: "Developer Tools",
        tags: ["api", "testing", "json", "acceptance-criteria", "deterministic"],
        priceCents: 1,
        offerType: "api",
        endpoint: expectedEndpoint,
        httpMethod: "POST",
        inputSchema: JSON.stringify({ input: "API feature brief or bug report" }),
        outputSchema:
          "JSON object: summary, assumptions[], acceptance_criteria[], test_cases[6], edge_cases[], open_questions[]",
      }),
    },
    credentials.apiKey,
  );
  if (!creation.response.ok) {
    throw new Error(
      `PayanAgent offer creation failed (${creation.response.status}): ${creation.body?.error ?? "unknown"}`,
    );
  }
  const offerId = creation.body?.offerId ?? creation.body?.id ?? creation.body?.offer?.id;
  if (!offerId) throw new Error("PayanAgent created no identifiable offer");
  const current = await request(`/api/v1/offers/${encodeURIComponent(offerId)}`);
  if (!current.response.ok) throw new Error("PayanAgent offer was not publicly readable");
  offer = current.body?.offer ?? current.body;
  created = true;
} else {
  if (state?.endpoint !== expectedEndpoint) {
    const update = await request(
      `/api/v1/offers/${encodeURIComponent(state.offerId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: expectedEndpoint, httpMethod: "POST" }),
      },
      credentials.apiKey,
    );
    if (!update.response.ok) {
      throw new Error(`PayanAgent endpoint update failed (${update.response.status})`);
    }
    offer = update.body?.offer ?? update.body;
  }
}

const offerId = offer._id ?? offer.id ?? offer.offerId;
if (!offerId) throw new Error("PayanAgent offer ID could not be recovered");
const publicState = {
  agentId: credentials.agentId,
  offerId,
  title: offer.title,
  status: offer.status ?? "active",
  endpoint: expectedEndpoint,
  priceUsd: offer.priceUsd ?? "0.01",
  walletAddress: targetBaseWallet,
  updatedAt: new Date().toISOString(),
};
await writeFile(statePath, `${JSON.stringify(publicState, null, 2)}\n`, { mode: 0o600 });
await chmod(statePath, 0o600);

console.log(
  JSON.stringify({
    registered,
    created,
    agentId: credentials.agentId,
    offerId,
    status: publicState.status,
    priceUsd: publicState.priceUsd,
    walletMatches: true,
  }),
);
