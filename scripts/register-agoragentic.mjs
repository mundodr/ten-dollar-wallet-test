import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://agoragentic.com/api";
const stateDir = path.resolve(".agoragentic");
const credentialsPath = path.join(stateDir, "credentials.json");
const targetWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function save(credentials) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function request(pathname, { method = "GET", body, apiKey } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(`${apiBase}${pathname}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(
          `Agoragentic ${pathname} failed (${response.status}): ${payload?.error ?? payload?.message ?? "unknown error"}`,
        );
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (error.status && error.status < 500) break;
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
    }
  }
  throw lastError;
}

let credentials;
if (await exists(credentialsPath)) {
  credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
} else {
  const registered = await request("/quickstart", {
    method: "POST",
    body: {
      name: "TenDollarWalletWorker",
      description:
        "Deterministic API acceptance criteria, JSON validation, public-source research, code review, and technical documentation. No spam, KYC handling, private-network access, or prohibited scraping.",
      intent: "seller",
      agent_uri: "agent://ten-dollar-wallet-worker",
      owner_email: "ten-dollar-wallet-lab@0fc6f5.inboxapi.ai",
    },
  });
  if (!registered?.id || !registered?.api_key) {
    throw new Error("Agoragentic registration omitted the required identity or API key");
  }
  credentials = {
    agentId: registered.id,
    apiKey: registered.api_key,
    signingKey: registered.signing_key ?? null,
    publicKey: registered.public_key ?? null,
    agentUri: registered.agent_uri ?? null,
    registeredAt: new Date().toISOString(),
    targetWallet,
  };
  await save(credentials);
}

if (credentials.targetWallet?.toLowerCase() !== targetWallet) {
  throw new Error("Stored Agoragentic forwarding target does not match the approved Base address");
}

const [profile, sellerStatus, demand, opportunities] = await Promise.all([
  request("/agents/me", { apiKey: credentials.apiKey }),
  request("/seller/status", { apiKey: credentials.apiKey }),
  request("/seller/demand", { apiKey: credentials.apiKey }),
  request("/seller/work-opportunities?limit=100", { apiKey: credentials.apiKey }),
]);

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agentId: credentials.agentId,
      agentUri: credentials.agentUri,
      targetWallet: credentials.targetWallet,
      exactForwardingTarget: credentials.targetWallet.toLowerCase() === targetWallet,
      profile,
      sellerStatus,
      demand,
      opportunities,
      credentialsPath,
      countingPolicy:
        "Registration, listings, calls, receipts, and internal balances do not count; only a matching Base-mainnet transfer to the disclosed target counts.",
    },
    null,
    2,
  ),
);
