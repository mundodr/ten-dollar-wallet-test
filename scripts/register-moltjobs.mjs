import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const mailboxApi = "https://api.mail.tm";
const moltJobsApi = "https://api.moltjobs.io/v1";
const credentialsDir = path.resolve(".moltjobs");
const mailboxPath = path.join(credentialsDir, "mailbox.json");
const signupPath = path.join(credentialsDir, "signup.json");
const claimMessagePath = path.join(credentialsDir, "claim-message.json");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function jsonRequest(url, options = {}) {
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(url, {
        ...options,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
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
  if (!response.ok) {
    const error = new Error(`Request failed (${response.status}) for ${new URL(url).pathname}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function collectionMembers(value) {
  if (Array.isArray(value)) return value;
  return value?.["hydra:member"] ?? value?.member ?? [];
}

async function createMailbox() {
  try {
    return { ...(await readJson(mailboxPath)), reused: true };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const domains = await jsonRequest(`${mailboxApi}/domains`);
  const available = collectionMembers(domains).find(
    (domain) => domain.isActive && !domain.isPrivate,
  );
  if (!available?.domain) throw new Error("Mail.tm returned no active public domain");

  const suffix = randomBytes(5).toString("hex");
  const address = `ten-dollar-wallet-${suffix}@${available.domain}`;
  const password = randomBytes(32).toString("base64url");
  const account = await jsonRequest(`${mailboxApi}/accounts`, {
    method: "POST",
    body: JSON.stringify({ address, password }),
  });
  const auth = await jsonRequest(`${mailboxApi}/token`, {
    method: "POST",
    body: JSON.stringify({ address, password }),
  });
  const mailbox = {
    address,
    password,
    accountId: account.id,
    token: auth.token,
    provider: "mail.tm",
    createdAt: new Date().toISOString(),
  };
  await writePrivateJson(mailboxPath, mailbox);
  return { ...mailbox, reused: false };
}

async function requestSignup(mailbox) {
  try {
    return { ...(await readJson(signupPath)), reused: true };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const baseHandle = "ten-dollar-wallet-worker";
  const signupPayload = {
    agentHandle: baseHandle,
    name: "Ten Dollar Wallet Worker",
    vertical: "DATA_AUTOMATION",
    ownerEmail: mailbox.address,
    description:
      "Small tested CSV/JSON transformations, public-source research, documentation, and repository automation. Public samples: https://github.com/mundodr/ten-dollar-wallet-test",
    source: "skill",
    client: "ten-dollar-wallet-test/1.0",
    campaign: "public-paid-work",
  };

  let result;
  try {
    result = await jsonRequest(`${moltJobsApi}/agent-signups`, {
      method: "POST",
      headers: { "User-Agent": "moltjobs-skill/1.1.0" },
      body: JSON.stringify(signupPayload),
    });
  } catch (error) {
    if (error.status !== 409) throw error;
    signupPayload.agentHandle = `${baseHandle}-${randomBytes(3).toString("hex")}`;
    result = await jsonRequest(`${moltJobsApi}/agent-signups`, {
      method: "POST",
      headers: { "User-Agent": "moltjobs-skill/1.1.0" },
      body: JSON.stringify(signupPayload),
    });
  }

  const signup = {
    ...result,
    agentHandle: signupPayload.agentHandle,
    ownerEmail: mailbox.address,
    requestedAt: new Date().toISOString(),
  };
  await writePrivateJson(signupPath, signup);
  return { ...signup, reused: false };
}

async function waitForClaimMessage(mailbox, timeoutMs = 30_000) {
  try {
    const existing = await readJson(claimMessagePath);
    return { message: existing, reused: true };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await jsonRequest(`${mailboxApi}/messages`, {
      headers: { Authorization: `Bearer ${mailbox.token}` },
    });
    const match = collectionMembers(messages).find(
      (message) =>
        /moltjobs/i.test(message.from?.address ?? "") ||
        /moltjobs|claim your agent/i.test(message.subject ?? ""),
    );
    if (match) {
      const fullMessage = await jsonRequest(`${mailboxApi}/messages/${match.id}`, {
        headers: { Authorization: `Bearer ${mailbox.token}` },
      });
      await writePrivateJson(claimMessagePath, fullMessage);
      return { message: fullMessage, reused: false };
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return { message: null, reused: false };
}

await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
await chmod(credentialsDir, 0o700);

const mailbox = await createMailbox();
const signup = await requestSignup(mailbox);
const claim = await waitForClaimMessage(mailbox);

console.log(
  JSON.stringify(
    {
      mailboxCreated: !mailbox.reused,
      mailboxProvider: mailbox.provider,
      signupCreated: !signup.reused,
      agentHandle: signup.agentHandle,
      intentId: signup.intentId ?? signup.data?.intentId ?? null,
      expiresAt: signup.expiresAt ?? signup.data?.expiresAt ?? null,
      claimEmailReceived: Boolean(claim.message),
      claimEmailSubject: claim.message?.subject ?? null,
      credentialsDir,
    },
    null,
    2,
  ),
);
