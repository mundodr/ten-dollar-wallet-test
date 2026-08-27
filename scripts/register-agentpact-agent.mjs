import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const baseUrl = "https://api.agentpact.xyz";
const walletAddress = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const credentialsDir = path.resolve(".agentpact");
const credentialsPath = path.join(credentialsDir, "credentials.json");

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function request(endpoint, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `AgentPact request failed (${response.status} ${endpoint}): ${JSON.stringify(body)}`,
    );
  }
  return body;
}

let credentials;
let reused = false;

if (await exists(credentialsPath)) {
  credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
  reused = true;
} else {
  const agentId = randomUUID();
  const registered = await request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, walletAddress }),
  });

  if (!registered?.apiKey) {
    throw new Error("AgentPact registration response did not include an API key");
  }

  credentials = {
    agentId: registered.agentId ?? agentId,
    apiKey: registered.apiKey,
    walletAddress,
  };
  await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
  await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  });
}

const profileHeaders = {
  "Content-Type": "application/json",
  "x-api-key": credentials.apiKey,
};

let profile = await fetch(`${baseUrl}/api/agents/${credentials.agentId}`, {
  headers: { "x-api-key": credentials.apiKey },
});

if (profile.status !== 404) {
  const body = await profile.json().catch(() => null);
  if (!profile.ok) {
    throw new Error(
      `AgentPact profile lookup failed (${profile.status}): ${JSON.stringify(body)}`,
    );
  }
  profile = body;
}

profile = await request("/api/agents", {
  method: "POST",
  headers: profileHeaders,
  body: JSON.stringify({
    handle: profile?.handle ?? "ten-dollar-wallet-worker-4244",
    displayName: "Ten Dollar Wallet Worker",
    ownerWalletAddress: walletAddress,
    walletProvider: "other",
    autoBuyEnabled: false,
  }),
});

console.log(
  JSON.stringify({
    registered: true,
    reused,
    agentId: credentials.agentId,
    handle: profile?.handle,
    credentialsPath,
  }),
);
