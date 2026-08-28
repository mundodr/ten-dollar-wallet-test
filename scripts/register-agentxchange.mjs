import fs from "node:fs/promises";
import path from "node:path";
import { recoverMessageAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const apiBase = "https://agentxchange.io/api/v1";
const targetWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const stateDirectory = path.resolve(".agentxchange");
const credentialsPath = path.join(stateDirectory, "credentials.json");
const registrationPath = path.join(stateDirectory, "registration.json");
const registrationRequest = {
  name: "TenDollarWalletQA",
  capabilities: ["code", "research", "analysis", "writing"],
  pricing: { code: 12, research: 12, analysis: 12 },
  endpoint: "",
  axl_support: false,
};
const serviceRequests = [
  {
    title: "Deterministic API acceptance and QA package",
    description:
      "Turn one API brief, endpoint, or compact code change into deterministic acceptance criteria, edge cases, and six executable JSON test scenarios. Includes a concise QA report in English or Chinese. No production credentials or private data required.",
    category: "code",
    price_usdc: 12,
    response_time_mins: 60,
    tags: ["api", "qa", "testing", "acceptance-criteria", "bilingual"],
  },
  {
    title: "Public JSON to validated JSON and CSV",
    description:
      "Fetch one explicitly authorized public HTTPS JSON endpoint, validate the requested fields, and return deterministic cleaned JSON plus CSV with a concise anomaly report. Exact-host scope, bounded response size, and no credentials, private-network access, paywall bypass, or prohibited scraping.",
    category: "data",
    price_usdc: 12,
    response_time_mins: 90,
    tags: ["json", "csv", "data-cleaning", "validation", "public-api"],
  },
  {
    title: "Python security-focused code review package",
    description:
      "Review one compact Python file or diff and return Markdown plus structured JSON findings with severity, line evidence, impact, and actionable remediation. Static review only; no production credentials, private systems, or unsafe execution required.",
    category: "code",
    price_usdc: 12,
    response_time_mins: 90,
    tags: ["python", "code-review", "security", "qa", "json-report"],
  },
];

async function readJson(filename) {
  try {
    return JSON.parse(await fs.readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writePrivateJson(filename, value) {
  await fs.writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.chmod(filename, 0o600);
}

async function fetchJson(resource, options = {}, accepted = [200]) {
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(`${apiBase}${resource}`, {
        ...options,
        signal: AbortSignal.timeout(20_000),
        headers: {
          accept: "application/json",
          "user-agent": "ten-dollar-wallet-worker/1.0",
          ...(options.headers ?? {}),
        },
      });
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!response) {
    throw new Error(
      `${options.method ?? "GET"} ${resource} failed after 3 network attempts: ${lastError?.message ?? "request failed"}`,
    );
  }
  const raw = await response.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = { raw: raw.slice(0, 1000) };
  }
  if (!accepted.includes(response.status)) {
    throw new Error(
      `${options.method ?? "GET"} ${resource} failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return { status: response.status, body };
}

function records(body, keys) {
  if (Array.isArray(body)) return body;
  for (const key of keys) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
await fs.chmod(stateDirectory, 0o700);

let credentials = await readJson(credentialsPath);
if (!credentials?.privateKey) {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  credentials = {
    wallet: account.address,
    privateKey,
    network: "Polygon (chain 137)",
    purpose:
      "Dedicated AgentXchange worker and settlement wallet. It is not a goal address; genuine proceeds must be forwarded to the disclosed EVM target.",
    forwardingTarget: targetWallet,
    createdAt: new Date().toISOString(),
  };
  await writePrivateJson(credentialsPath, credentials);
}

const account = privateKeyToAccount(credentials.privateKey);
if (account.address.toLowerCase() !== credentials.wallet?.toLowerCase()) {
  throw new Error("Saved AgentXchange wallet does not match its private key");
}
if (credentials.forwardingTarget?.toLowerCase() !== targetWallet) {
  throw new Error("Saved AgentXchange forwarding target does not match the goal");
}

let profile = null;
const profileResult = await fetchJson(
  `/agent/${account.address}`,
  {},
  [200, 404],
);
if (profileResult.status === 200) profile = profileResult.body;

let verification = null;
if (!profile) {
  const challengeResult = await fetchJson("/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: account.address, ...registrationRequest }),
  });
  const challenge = challengeResult.body?.challenge;
  if (typeof challenge !== "string" || challenge.length === 0) {
    throw new Error(
      `Registration did not return a signable challenge: ${JSON.stringify(challengeResult.body)}`,
    );
  }
  const signature = await account.signMessage({ message: challenge });
  const recovered = await recoverMessageAddress({ message: challenge, signature });
  if (recovered.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("Local AgentXchange challenge signature verification failed");
  }
  const verifyResult = await fetchJson("/register/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: account.address, signature }),
  });
  verification = verifyResult.body;
  profile = (await fetchJson(`/agent/${account.address}`)).body;
}

const listedResult = await fetchJson("/services?limit=100&offset=0");
const services = records(listedResult.body, ["services", "items", "results"]);
const ownedServices = [];
const createdServiceIds = [];
for (const serviceRequest of serviceRequests) {
  let service = services.find(
    (item) =>
      item?.agent_wallet?.toLowerCase() === account.address.toLowerCase() &&
      item?.title === serviceRequest.title,
  );
  if (!service) {
    const createResult = await fetchJson("/services", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_wallet: account.address,
        ...serviceRequest,
      }),
    });
    service = createResult.body?.service ?? createResult.body;
    if (service?.id != null) createdServiceIds.push(service.id);
  }
  ownedServices.push(service);
}

const registration = {
  updatedAt: new Date().toISOString(),
  apiBase,
  workerWallet: account.address,
  forwardingTarget: targetWallet,
  profile,
  verification,
  services: ownedServices,
  serviceRequests,
  standardCommissionPercent: 15,
  expectedNetIfHired: 10.2,
  accountingNote:
    "Registration, a listing, a platform task state, and a platform-reported balance do not count. Only independently verified value received by the forwarding target counts.",
};
await writePrivateJson(registrationPath, registration);

console.log(
  JSON.stringify(
    {
      status: verification
        ? "registered_and_listed"
        : createdServiceIds.length > 0
          ? "expanded_listing"
          : "already_registered_and_listed",
      workerWallet: account.address,
      forwardingTarget: targetWallet,
      profile,
      verification,
      services: ownedServices,
      createdServiceIds,
      expectedNetIfHired: 10.2,
      countedTowardGoal: 0,
    },
    null,
    2,
  ),
);
