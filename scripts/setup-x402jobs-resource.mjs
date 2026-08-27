import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiUrl = "https://api.x402.jobs";
const supabaseUrl = "https://mgvojndnifjbxvdxkdyd.supabase.co";
const publishableKey = "sb_publishable_T9Ruv1HSZ9Vx3uqbxY_ixg_aV_SPlBA";
const credentialsPath = path.resolve(".x402jobs/credentials.json");
const statePath = path.resolve(".x402jobs/resource-state.json");
const resourceName = "Deterministic API Brief Acceptance Checklist";
const resourceUrl =
  "https://payanagent.com/x402/kh7ezjzt4etk8x1s908z7wngqn8d89hx";
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

async function request(url, options = {}) {
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  if (!response) throw lastError ?? new Error(`No response from ${new URL(url).host}`);
  const body = await response.json().catch(() => null);
  return { response, body };
}

let credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
const session = await request(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: {
    apikey: publishableKey,
    Authorization: `Bearer ${publishableKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email: credentials.email,
    password: credentials.password,
  }),
});
if (!session.response.ok || !session.body?.access_token) {
  throw new Error(`x402.jobs session refresh failed (${session.response.status})`);
}
credentials = {
  ...credentials,
  accessToken: session.body.access_token,
  refreshToken: session.body.refresh_token,
  expiresAt: new Date(Date.now() + (session.body.expires_in ?? 3600) * 1_000).toISOString(),
  updatedAt: new Date().toISOString(),
};

const authHeaders = {
  Authorization: `Bearer ${credentials.accessToken}`,
  "Content-Type": "application/json",
};
if (!credentials.apiKey) {
  const keys = await request(`${apiUrl}/api/keys`, { headers: authHeaders });
  if (!keys.response.ok) {
    throw new Error(`x402.jobs API key list failed (${keys.response.status})`);
  }
  const activeKey = (keys.body?.data ?? []).find((key) => key.is_active && key.key);
  if (activeKey?.key) credentials.apiKey = activeKey.key;
}
if (!credentials.apiKey) {
  const creation = await request(`${apiUrl}/api/keys`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      name: "ten-dollar-wallet-resource-indexer",
      description: "Registers and monitors one public Base-mainnet x402 resource.",
    }),
  });
  if (!creation.response.ok || !creation.body?.data?.key) {
    throw new Error(`x402.jobs API key creation failed (${creation.response.status})`);
  }
  credentials.apiKey = creation.body.data.key;
  credentials.apiKeyId = creation.body.data.id;
}
await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, {
  mode: 0o600,
});
await chmod(credentialsPath, 0o600);

const checkUrl = new URL("/api/v1/resources/check", apiUrl);
checkUrl.searchParams.set("url", resourceUrl);
let check = await request(checkUrl, {
  headers: { Accept: "application/json" },
});
let created = false;
if (!check.response.ok) {
  throw new Error(`x402.jobs public resource check failed (${check.response.status})`);
}

if (!check.body?.found) {
  const creation = await request(`${apiUrl}/resources`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      resourceUrl,
      network: "base",
      name: resourceName,
      payTo: targetBaseWallet,
      description:
        "Compile an English or Chinese API brief into strict JSON acceptance criteria, assumptions, edge cases, open questions, and six test scenarios. Pay 0.01 USDC directly to the disclosed Base wallet through PayanAgent x402.",
      category: "developer-tools",
      maxAmountRequired: "10000",
      asset: baseUsdc,
      mimeType: "application/json",
      maxTimeoutSeconds: 60,
      outputSchema: {
        summary: "string",
        assumptions: ["string"],
        acceptance_criteria: ["string"],
        test_cases: ["six executable-style scenarios"],
        edge_cases: ["string"],
        open_questions: ["string"],
      },
      supportsRefunds: false,
    }),
  });
  if (!creation.response.ok || !creation.body?.resource?.id) {
    throw new Error(
      `x402.jobs resource creation failed (${creation.response.status}): ${creation.body?.error ?? creation.body?.message ?? "unknown"}`,
    );
  }
  created = true;
  check = await request(checkUrl, { headers: { Accept: "application/json" } });
}

const resource = check.body?.resource;
if (!check.body?.found || !resource?.id) {
  throw new Error("x402.jobs did not expose the registered resource publicly");
}
const publicUrl =
  resource.x402jobs_url ??
  (resource.server_slug && resource.slug
    ? `https://www.x402.jobs/resources/${resource.server_slug}/${resource.slug}`
    : null);
const state = {
  resourceId: resource.id,
  resourceName,
  resourceUrl,
  publicUrl,
  network: resource.network ?? null,
  price: resource.price ?? null,
  createdAt: new Date().toISOString(),
};
await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
await chmod(statePath, 0o600);

console.log(
  JSON.stringify(
    {
      created,
      found: true,
      resourceId: state.resourceId,
      publicUrl: state.publicUrl,
      network: state.network,
      price: state.price,
      apiKeyConfigured: true,
    },
    null,
    2,
  ),
);
