import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const hansaApi = "https://www.agenthansa.com";
const mailboxApi = "https://api.mail.tm";
const solanaWallet = "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt";
const hansaCredentials = JSON.parse(
  await readFile(path.resolve(".agenthansa/credentials.json"), "utf8"),
);
const mailbox = JSON.parse(await readFile(path.resolve(".moltjobs/mailbox.json"), "utf8"));
const verificationPath = path.resolve(".agenthansa/email-verification.json");

async function request(url, options = {}) {
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(url, options);
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
    const message = body?.detail ?? body?.message ?? `HTTP ${response.status}`;
    throw new Error(`${new URL(url).pathname} failed: ${message}`);
  }
  return body;
}

function hansaRequest(route, options = {}) {
  return request(`${hansaApi}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${hansaCredentials.apiKey}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
}

function collectionMembers(value) {
  if (Array.isArray(value)) return value;
  return value?.["hydra:member"] ?? value?.member ?? [];
}

async function waitForVerificationCode(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await request(`${mailboxApi}/messages`, {
      headers: { Authorization: `Bearer ${mailbox.token}`, Accept: "application/json" },
    });
    const summary = collectionMembers(messages).find(
      (message) =>
        /agenthansa/i.test(message.from?.address ?? "") ||
        /agenthansa|verification code|verify your email/i.test(message.subject ?? ""),
    );
    if (summary) {
      const message = await request(`${mailboxApi}/messages/${summary.id}`, {
        headers: { Authorization: `Bearer ${mailbox.token}`, Accept: "application/json" },
      });
      const content = [
        message.subject,
        message.text,
        ...(Array.isArray(message.html) ? message.html : [message.html]),
      ]
        .filter(Boolean)
        .join("\n");
      const code = content.match(/(?:code[^0-9]{0,40})?\b(\d{6})\b/i)?.[1];
      if (!code) throw new Error("Agent Hansa verification email contained no 6-digit code");
      await writeFile(
        verificationPath,
        `${JSON.stringify(
          { messageId: message.id, subject: message.subject, code, receivedAt: new Date().toISOString() },
          null,
          2,
        )}\n`,
        { mode: 0o600 },
      );
      await chmod(verificationPath, 0o600);
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Timed out waiting for Agent Hansa verification email");
}

let profile = await hansaRequest("/api/agents/me");
let emailVerified = Boolean(profile.email_verified);
if (!emailVerified) {
  await hansaRequest("/api/agents/email", {
    method: "POST",
    body: JSON.stringify({ email: mailbox.address }),
  });
  const code = await waitForVerificationCode();
  await hansaRequest("/api/agents/email/verify", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  emailVerified = true;
}

let walletResult = null;
if (profile.wallet_address !== solanaWallet) {
  walletResult = await hansaRequest("/api/agents/wallet", {
    method: "PUT",
    body: JSON.stringify({ wallet_address: solanaWallet }),
  });
}
profile = await hansaRequest("/api/agents/me");

console.log(
  JSON.stringify(
    {
      agentId: hansaCredentials.agentId,
      emailVerified: Boolean(profile.email_verified ?? emailVerified),
      walletConfigured:
        profile.wallet_address === solanaWallet || walletResult?.wallet_address === solanaWallet,
      walletAddress: profile.wallet_address ?? walletResult?.wallet_address ?? null,
      payoutDestination: profile.payout_destination ?? null,
      earnings: profile.earnings ?? profile.balance ?? null,
    },
    null,
    2,
  ),
);
