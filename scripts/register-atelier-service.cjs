const { mkdir, readFile, writeFile, chmod } = require("node:fs/promises");
const path = require("node:path");

const apiBase = "https://api.useatelier.ai/api";
const targetAddress = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const privateDir = path.resolve(".atelier");
const credentialsPath = path.join(privateDir, "credentials.json");
const solanaKeypairPath = path.join(privateDir, "owner-solana-keypair.json");
const endpointUrl =
  "https://begins-greatly-badge-dealers.trycloudflare.com/invoke";
const serviceDefinitions = [
  {
    title: "API Brief Acceptance Checklist",
    description:
      "Turns an English or Chinese API feature brief into structured JSON acceptance criteria, assumptions, edge cases, open questions, and six reproducible test scenarios.",
    briefLabel: "API feature brief",
    placeholder:
      "Describe the endpoint, behavior, inputs, outputs, integrations, and constraints.",
  },
  {
    title: "JSON API Edge-Case Matrix",
    description:
      "Turns a JSON API contract or behavior brief into six reproducible happy-path, validation, authorization, atomicity, and repeatability test scenarios.",
    briefLabel: "JSON API contract or behavior brief",
    placeholder:
      "Describe the method, route, fields, status codes, authorization, and boundary rules.",
  },
  {
    title: "Webhook Failure & Retry Checklist",
    description:
      "Turns a webhook integration brief into structured JSON acceptance criteria covering authentication, retry safety, failure atomicity, and concurrent delivery edge cases.",
    briefLabel: "Webhook integration brief",
    placeholder:
      "Describe delivery, signature verification, retry, idempotency, timeout, and failure behavior.",
  },
  {
    title: "API Auth & Pagination QA Matrix",
    description:
      "Turns an authenticated or paginated API brief into structured JSON acceptance criteria and reproducible tests for permissions, boundaries, duplicates, and omissions.",
    briefLabel: "Authenticated or paginated API brief",
    placeholder:
      "Describe roles, credentials, cursor or page behavior, response fields, and error cases.",
  },
];

function servicePayload(definition) {
  return {
    category: "coding",
    title: definition.title,
    description: definition.description,
    price_usd: "0.01",
    price_type: "fixed",
    turnaround_hours: 1,
    deliverables: ["code", "text"],
    max_revisions: 1,
    requirement_fields: [
      {
        label: definition.briefLabel,
        type: "textarea",
        required: true,
        placeholder: definition.placeholder,
      },
      {
        label: "Response language",
        type: "select",
        required: false,
        options: ["English", "Chinese", "Bilingual"],
      },
    ],
  };
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function requestJson(route, options = {}) {
  const response = await fetch(`${apiBase}${route}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { nonJsonResponse: text.slice(0, 200) };
  }
  if (!response.ok || body?.success === false) {
    const message = body?.error?.message ?? body?.error ?? body?.message ?? "unknown error";
    const error = new Error(`Atelier ${options.method ?? "GET"} ${route} failed (${response.status}): ${message}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body?.data ?? body;
}

async function getX402Discovery(serviceId) {
  const response = await fetch(
    `${apiBase}/x402/discover?service_id=${encodeURIComponent(serviceId)}`,
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.json().catch(() => null);
  if (response.status !== 402 || !body) {
    throw new Error(
      `Atelier x402 discovery failed (${response.status}): ${body?.error ?? "missing payment challenge"}`,
    );
  }
  return body?.data ?? body;
}

async function loadOrCreateOwnerWallet() {
  const { Keypair } = require("@solana/web3.js");
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  await chmod(privateDir, 0o700);
  const existing = await readJsonIfPresent(solanaKeypairPath);
  if (existing?.secretKey) {
    return Keypair.fromSecretKey(Uint8Array.from(existing.secretKey));
  }

  const keypair = Keypair.generate();
  await writeFile(
    solanaKeypairPath,
    `${JSON.stringify({ secretKey: Array.from(keypair.secretKey) })}\n`,
    { mode: 0o600 },
  );
  await chmod(solanaKeypairPath, 0o600);
  return keypair;
}

async function register(wallet) {
  const nacl = require("tweetnacl");
  const bs58Module = require("bs58");
  const bs58 = bs58Module.default ?? bs58Module;
  const ownerAddress = wallet.publicKey.toBase58();
  const timestamp = Date.now();
  const message = `atelier:${ownerAddress}:${timestamp}`;
  const walletSignature = bs58.encode(
    nacl.sign.detached(Buffer.from(message, "utf8"), wallet.secretKey),
  );
  const suffix = ownerAddress.slice(0, 6).toLowerCase();
  const data = await requestJson("/agents/register", {
    method: "POST",
    body: JSON.stringify({
      name: `Ten Dollar API QA ${suffix}`,
      description:
        "Deterministic API acceptance-checklist provider for English and Chinese feature briefs, returning structured JSON and reproducible test scenarios.",
      capabilities: ["coding", "automation", "analytics"],
      owner_wallet: ownerAddress,
      wallet: ownerAddress,
      wallet_sig: walletSignature,
      wallet_sig_ts: timestamp,
      wallet_chain: "solana",
    }),
  });

  const agentId = data?.agent_id ?? data?.id;
  const apiKey = data?.api_key;
  if (!agentId || !apiKey) {
    throw new Error("Atelier registration succeeded without an agent ID or API key");
  }
  const credentials = {
    agentId,
    apiKey,
    webhookSecret: data?.webhook_secret ?? null,
    slug: data?.slug ?? null,
    ownerAddress,
    targetAddress,
    registeredAt: new Date().toISOString(),
  };
  await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(credentialsPath, 0o600);
  return credentials;
}

function base58Encode(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros += 1;
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let encoded = "";
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  return "1".repeat(leadingZeros) + encoded;
}

async function savedOwnerAddress() {
  const saved = await readJsonIfPresent(solanaKeypairPath);
  if (!Array.isArray(saved?.secretKey) || saved.secretKey.length !== 64) {
    throw new Error("Saved Atelier owner keypair is missing or invalid");
  }
  return base58Encode(saved.secretKey.slice(32));
}

function listFrom(data, key) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[key])) return data[key];
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

async function main() {
let credentials = await readJsonIfPresent(credentialsPath);
if (!credentials) {
  const wallet = await loadOrCreateOwnerWallet();
  credentials = await register(wallet);
}
const ownerAddress = await savedOwnerAddress();
if (credentials.ownerAddress !== ownerAddress) {
  throw new Error("Saved Atelier credentials do not match the encrypted owner wallet");
}

const authHeaders = { Authorization: `Bearer ${credentials.apiKey}` };
await requestJson("/agents/me", {
  method: "PATCH",
  headers: authHeaders,
  body: JSON.stringify({
    payout_address_base: targetAddress,
    payout_chain: "base",
    endpoint_url: endpointUrl,
  }),
});

let services = listFrom(
  await requestJson(`/agents/${credentials.agentId}/services`, { headers: authHeaders }),
  "services",
);
for (const definition of serviceDefinitions) {
  let service = services.find((item) => item?.title === definition.title);
  if (!service) {
    service = await requestJson(`/agents/${credentials.agentId}/services`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(servicePayload(definition)),
    });
    services.push(service);
  }
  const configuredServiceId = service?.id ?? service?.service_id;
  if (!configuredServiceId) throw new Error(`Atelier service ${definition.title} has no ID`);
  await requestJson(`/services/${configuredServiceId}`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify(servicePayload(definition)),
  });
}

const [profile, refreshedServices] = await Promise.all([
  requestJson("/agents/me", { headers: authHeaders }),
  requestJson(`/agents/${credentials.agentId}/services`, { headers: authHeaders }),
]);
services = listFrom(refreshedServices, "services");
const profilePayout =
  profile?.payout_address_base ?? profile?.payout_wallet ?? profile?.payout_address ?? null;
const exactPayout =
  typeof profilePayout === "string" &&
  profilePayout.toLowerCase() === targetAddress.toLowerCase() &&
  profile?.payout_chain === "base";
const configuredServices = serviceDefinitions.map((definition) => {
  const service = services.find((item) => item?.title === definition.title);
  const id = service?.id ?? service?.service_id ?? null;
  const exact =
    service?.category === "coding" &&
    service?.description === definition.description &&
    Number(service?.price_usd) === 0.01 &&
    service?.price_type === "fixed" &&
    service?.active !== 0 &&
    service?.active !== false;
  return { definition, service, id, exact };
});
const x402Discoveries = await Promise.all(
  configuredServices.map(({ id }) => {
    if (!id) throw new Error("Atelier configured service has no ID");
    return getX402Discovery(id);
  }),
);
const serviceChecks = configuredServices.map((configured, index) => {
  const discovery = x402Discoveries[index];
  const baseQuote = discovery?.accepts?.find(
    (item) => item?.network === "eip155:8453",
  );
  const x402Listed =
    discovery?.resource?.url?.endsWith(configured.id) === true &&
    baseQuote?.asset?.toLowerCase() ===
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" &&
    baseQuote?.amount === "11000";
  return {
    id: configured.id,
    title: configured.service?.title ?? null,
    priceUsd: configured.service?.price_usd ?? null,
    exactService: configured.exact,
    x402Listed,
    baseX402AmountAtomic: baseQuote?.amount ?? null,
  };
});
const exactServices = serviceChecks.every(
  (service) => service.exactService && service.x402Listed,
);

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agentId: credentials.agentId,
      slug: credentials.slug ?? profile?.slug ?? null,
      ownerAddress,
      marketable: profile?.marketable ?? null,
      verified: profile?.verified ?? null,
      endpointUrl: profile?.endpoint_url ?? null,
      hasEndpoint: Boolean(profile?.endpoint_url ?? profile?.has_endpoint),
      payoutChain: profile?.payout_chain ?? null,
      payoutAddress: profilePayout,
      exactPayout,
      services: serviceChecks,
      publicAgentUrl: credentials.slug
        ? `https://app.useatelier.ai/agents/${credentials.slug}`
        : null,
    },
    null,
    2,
  ),
);

if (
  !exactPayout ||
  !exactServices ||
  profile?.endpoint_url !== endpointUrl
) {
  throw new Error("Atelier profile or service does not match the intended terms");
}
}

main().catch((error) => {
  console.error(error?.message ?? String(error));
  process.exitCode = 1;
});
