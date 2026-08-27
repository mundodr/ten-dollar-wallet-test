import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://api.agentstore.tools/api";
const credentialsDir = path.resolve(".agentstore");
const credentialsPath = path.join(credentialsDir, "credentials.json");
const listingPath = path.join(credentialsDir, "listing.json");
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const publisherId = "ten-dollar-wallet-lab";

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function requestJson(pathname, options = {}, allowedStatuses = []) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok && !allowedStatuses.includes(response.status)) {
    const error = new Error(`AgentStore ${pathname} failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return { status: response.status, body };
}

function containsString(value, expected) {
  if (typeof value === "string") return value.toLowerCase().includes(expected.toLowerCase());
  if (Array.isArray(value)) return value.some((item) => containsString(item, expected));
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => containsString(item, expected));
  }
  return false;
}

await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
await chmod(credentialsDir, 0o700);

let credentials;
let registered = false;
try {
  credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  const response = await requestJson("/publishers", {
    method: "POST",
    body: JSON.stringify({
      name: publisherId,
      display_name: "Ten Dollar Wallet Lab",
      payout_address: targetBaseWallet,
      support_url: "https://mundodr.github.io/ten-dollar-wallet-test/",
    }),
  });
  credentials = {
    publisherId: response.body?.publisher?.publisher_id ?? publisherId,
    apiKey: response.body?.api_key,
    registration: response.body,
    registeredAt: new Date().toISOString(),
  };
  if (!credentials.apiKey) throw new Error("AgentStore registration omitted an API key");
  await writePrivateJson(credentialsPath, credentials);
  registered = true;
}

const auth = { "X-API-Key": credentials.apiKey };
const profileResponse = await requestJson("/publishers/me", { headers: auth });
const profile = profileResponse.body?.publisher ?? profileResponse.body;
if (profile?.payout_address?.toLowerCase() !== targetBaseWallet) {
  throw new Error("AgentStore publisher payout address does not match the target Base wallet");
}

let listing;
let published = false;
try {
  listing = JSON.parse(await readFile(listingPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  const publishResponse = await requestJson("/publishers/agents/simple", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      publisher_id: credentials.publisherId,
      name: "API Contract Test Planner",
      type: "proprietary",
      description:
        "Turns an API brief or endpoint contract into a concise acceptance checklist, failure taxonomy, and six executable-style test scenarios without network or filesystem access.",
      version: "1.0.0",
      pricing: { model: "one_time", amount: 0.1 },
      tags: ["Development", "Testing", "API", "Productivity"],
      install: {
        agent_wrapper: {
          format: "markdown",
          entrypoint: "agent.md",
          content: `# API Contract Test Planner

Convert the buyer's API brief into deterministic QA artifacts. Do not call the endpoint or invent observed results.

Return JSON with these top-level keys: \`summary\`, \`assumptions\`, \`acceptance_criteria\`, \`test_scenarios\`, and \`risks\`.

Each acceptance criterion must be atomic, observable, and tagged \`functional\`, \`validation\`, \`security\`, \`reliability\`, or \`compatibility\`. Produce exactly six test scenarios covering: happy path, missing required input, invalid type or format, authorization failure, upstream or timeout failure, and boundary or idempotency behavior. Each scenario must include \`name\`, \`setup\`, \`request\`, \`expected_status\`, \`expected_body\`, and \`evidence_to_capture\`.

Clearly separate stated requirements from assumptions. Never include secrets, live credentials, fabricated traffic, or claims that tests ran.`,
        },
        gateway_routes: [],
      },
      permissions: { requires_network: false, requires_filesystem: false },
    }),
  });
  listing = publishResponse.body;
  await writePrivateJson(listingPath, listing);
  published = true;
}

const agentId = listing?.agent?.agent_id ?? listing?.agent_id;
if (!agentId) throw new Error("AgentStore listing state omitted the agent ID");
const [publicResponse, accessResponse, earnResponse] = await Promise.all([
  requestJson(`/agents/${encodeURIComponent(agentId)}`),
  requestJson(
    `/agents/${encodeURIComponent(agentId)}/access`,
    { headers: { "X-Wallet-Address": targetBaseWallet } },
    [402],
  ),
  requestJson("/publishers/me/earn-program", { headers: auth }),
]);
const publicAgent = publicResponse.body?.agent ?? publicResponse.body;
const accessBody = accessResponse.body;
const paymentNamesTarget = containsString(accessBody, targetBaseWallet);
if (publicAgent?.pricing?.model !== "one_time" || Number(publicAgent?.pricing?.amount) !== 0.1) {
  throw new Error("AgentStore paid listing price did not persist");
}
if (accessResponse.status !== 402 || !paymentNamesTarget) {
  throw new Error("AgentStore access challenge does not name the target payout address");
}

console.log(
  JSON.stringify(
    {
      registered,
      published,
      publisherId: credentials.publisherId,
      exactBasePayoutAddress: profile.payout_address.toLowerCase() === targetBaseWallet,
      agentId,
      name: publicAgent.name,
      type: publicAgent.type,
      pricing: publicAgent.pricing,
      accessStatus: accessResponse.status,
      paymentChallengeNamesTarget: paymentNamesTarget,
      totalSales: profile.total_sales ?? 0,
      totalEarnings: profile.total_earnings ?? 0,
      earnProgram: earnResponse.body?.current_month ?? null,
      note: "Only a matching Base USDC transfer counts toward the funding goal.",
    },
    null,
    2,
  ),
);
