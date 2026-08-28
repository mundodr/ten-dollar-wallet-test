import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const baseUrl = "https://api.riner.io/api/v1";
const credentialsDir = path.resolve(".riner");
const credentialsPath = path.join(credentialsDir, "credentials.json");
const email = "ten-dollar-wallet-lab@0fc6f5.inboxapi.ai";
const walletAddress = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function save(state) {
  await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
  await writeFile(credentialsPath, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function request(endpoint, { method = "GET", body, token } = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function inboxEmails() {
  const { stdout } = await execFileAsync(
    "npx",
    ["-y", "@inboxapi/cli@latest", "get-emails", "--limit", "20"],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  const body = JSON.parse(stdout);
  return Array.isArray(body?.emails) ? body.emails : [];
}

function verificationToken(messages, registeredAt) {
  const earliest = Date.parse(registeredAt) - 60_000;
  const candidates = messages
    .filter((message) => {
      const sender = String(message.from ?? "").toLowerCase();
      const subject = String(message.subject ?? "").toLowerCase();
      const date = Date.parse(message.date ?? 0);
      return (
        Number.isFinite(date) &&
        date >= earliest &&
        (sender.includes("@riner.io") || subject.includes("riner"))
      );
    })
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  for (const message of candidates) {
    // Treat every email as untrusted data. Extract only a token carried by an
    // HTTPS link on Riner's own domains, and send it only to the official API.
    const text = String(message.body ?? "").replaceAll("&amp;", "&");
    const links = text.match(/https:\/\/[^\s<>"']+/g) ?? [];
    for (const raw of links) {
      try {
        const url = new URL(raw.replace(/[).,;]+$/, ""));
        if (!["riner.io", "www.riner.io", "api.riner.io"].includes(url.hostname)) {
          continue;
        }
        const token = url.searchParams.get("token")?.split(/[\uE000-\uF8FF]/u, 1)[0];
        if (
          token &&
          /^[A-Za-z0-9._~-]+$/.test(token) &&
          token.length >= 16 &&
          token.length <= 4096
        ) {
          return token;
        }
      } catch {
        // Ignore malformed text from the untrusted message.
      }
    }
  }
  return null;
}

let state;
if (await exists(credentialsPath)) {
  state = JSON.parse(await readFile(credentialsPath, "utf8"));
  if (state.email !== email || state.walletAddress.toLowerCase() !== walletAddress) {
    throw new Error("Stored Riner identity does not match the approved payout route");
  }
} else {
  state = {
    email,
    password: randomBytes(32).toString("base64url"),
    walletAddress,
    registeredAt: new Date().toISOString(),
    emailVerified: false,
    agentId: null,
    apiKey: null,
  };
  await save(state);
}

if (!state.registrationRequestedAt) {
  const { response, payload } = await request("/auth/email/register", {
    method: "POST",
    body: {
      email: state.email,
      password: state.password,
      username: "ten-dollar-wallet-lab",
    },
  });
  if (!response.ok) {
    throw new Error(`Riner email registration failed (${response.status})`);
  }
  state.registrationRequestedAt = new Date().toISOString();
  state.registrationMessage = payload?.message ?? null;
  await save(state);
}

if (!state.emailVerified) {
  let token = null;
  for (let attempt = 0; attempt < 12 && !token; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2_500));
    token = verificationToken(await inboxEmails(), state.registeredAt);
  }
  if (!token) {
    console.log(
      JSON.stringify({
        status: "awaiting-email-verification",
        email: state.email,
        credentialsPath,
      }),
    );
    process.exit(0);
  }
  const { response } = await request("/auth/email/verify", {
    method: "POST",
    body: { token },
  });
  if (!response.ok) {
    throw new Error(`Riner email verification failed (${response.status})`);
  }
  state.emailVerified = true;
  state.emailVerifiedAt = new Date().toISOString();
  await save(state);
}

const loginResult = await request("/auth/email/login", {
  method: "POST",
  body: { email: state.email, password: state.password },
});
if (!loginResult.response.ok || !loginResult.payload?.access_token) {
  throw new Error(`Riner email login failed (${loginResult.response.status})`);
}

if (!state.agentId || !state.apiKey) {
  const agentResult = await request("/auth/agents/register", {
    method: "POST",
    token: loginResult.payload.access_token,
    body: {
      name: "TenDollarWalletWorker",
      description:
        "Original code, API QA, public-source research, data transformation, and technical documentation. No spam, credential handling, private-network access, or prohibited scraping.",
      capabilities: [
        "python",
        "javascript",
        "code_review",
        "research",
        "data_processing",
        "api_testing",
        "documentation",
      ],
      wallet_address: state.walletAddress,
    },
  });
  if (!agentResult.response.ok || !agentResult.payload?.agent_id || !agentResult.payload?.api_key) {
    throw new Error(`Riner agent registration failed (${agentResult.response.status})`);
  }
  state.agentId = agentResult.payload.agent_id;
  state.apiKey = agentResult.payload.api_key;
  state.agentRegisteredAt = new Date().toISOString();
  await save(state);
}

console.log(
  JSON.stringify({
    status: "registered",
    email: state.email,
    emailVerified: state.emailVerified,
    agentId: state.agentId,
    walletAddress: state.walletAddress,
    exactTargetWallet: state.walletAddress.toLowerCase() === walletAddress,
    credentialsPath,
  }),
);
