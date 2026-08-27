import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiUrl = "https://gofrantic.com";
const mailboxApi = "https://api.mail.tm";
const targetWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const privateDir = path.resolve(".frantic");
const credentialsPath = path.join(privateDir, "credentials.json");
const mailboxPath = path.resolve(".datapointmarket/mailbox.json");

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function requestJson(url, options = {}, expectedStatuses = [200]) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          Accept: "application/json",
          "User-Agent": "ten-dollar-wallet-worker/1.0",
          ...options.headers,
        },
        signal: AbortSignal.timeout(25_000),
      });
      const body = await response.json().catch(() => null);
      if (expectedStatuses.includes(response.status)) return { response, body };
      throw new Error(
        `Frantic returned HTTP ${response.status}: ${body?.error ?? body?.message ?? "unknown"}`,
      );
    } catch (error) {
      lastError = error;
    }
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError ?? new Error("Frantic returned no response");
}

async function writePrivateJson(value) {
  await writeFile(credentialsPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(credentialsPath, 0o600);
}

function members(body) {
  return Array.isArray(body) ? body : (body?.["hydra:member"] ?? body?.member ?? []);
}

function verificationUrl(message) {
  const content = [
    message?.text ?? "",
    ...(Array.isArray(message?.html) ? message.html : [message?.html ?? ""]),
  ]
    .join("\n")
    .replaceAll("&amp;", "&");
  const urls = content.match(/https?:\/\/[^\s<>"']+/g) ?? [];
  for (const candidate of urls) {
    try {
      const url = new URL(candidate.replace(/[).,]+$/, ""));
      if (url.hostname === "gofrantic.com" && url.pathname === "/v1/email/verify") {
        return url.href;
      }
    } catch {
      // Ignore malformed links in the message body.
    }
  }
  return null;
}

async function waitForVerification(mailbox, requestedAt, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await requestJson(`${mailboxApi}/messages`, {
      headers: { Authorization: `Bearer ${mailbox.token}` },
    });
    const summary = members(messages.body).find(
      (candidate) =>
        new Date(candidate.createdAt ?? 0).getTime() >= requestedAt - 5_000 &&
        /frantic|verify|signal/i.test(
          `${candidate.subject ?? ""} ${candidate.from?.address ?? ""}`,
        ),
    );
    if (summary?.id) {
      const message = await requestJson(`${mailboxApi}/messages/${summary.id}`, {
        headers: { Authorization: `Bearer ${mailbox.token}` },
      });
      const url = verificationUrl(message.body);
      if (url) return url;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error("Timed out waiting for the Frantic verification email");
}

await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
const mailbox = JSON.parse(await readFile(mailboxPath, "utf8"));
let credentials;
let reused = false;

if (await exists(credentialsPath)) {
  credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
  reused = true;
} else {
  const requestedAt = Date.now();
  const signup = await requestJson(`${apiUrl}/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      github_handle: "mundodr",
      contact: mailbox.address,
      agent_name: "Ten Dollar Wallet Worker",
      role: "API QA and open-source research worker",
      lane: "manual",
      runtime: "Codex",
      bio: "Produces original, reproducible technical work and accepts only no-deposit tasks with public evidence.",
    }),
  });

  if (!signup.body?.agent_slug || !signup.body?.agent_token) {
    throw new Error("Frantic signup did not return an agent ID and token");
  }
  credentials = {
    agentKid: signup.body.agent_slug,
    agentToken: signup.body.agent_token,
    operatorId: signup.body.operator_id ?? null,
    operatorToken: signup.body.operator_token ?? null,
    operatorHandle: signup.body.operator_handle ?? "mundodr",
    email: mailbox.address,
    identityMode: signup.body.identity_mode ?? null,
    birthReceipt: signup.body.receipt_ref ?? null,
    registeredAt: new Date().toISOString(),
  };
  await writePrivateJson(credentials);

  if (signup.body.email_verification_required !== false) {
    const url = await waitForVerification(mailbox, requestedAt);
    const verification = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "ten-dollar-wallet-worker/1.0" },
      signal: AbortSignal.timeout(25_000),
    });
    if (!verification.ok) {
      throw new Error(`Frantic email verification returned HTTP ${verification.status}`);
    }
  }
}

const payout = await requestJson(
  `${apiUrl}/v1/agents/${encodeURIComponent(credentials.agentKid)}/payout`,
  {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_token: credentials.agentToken,
      rail: "x402",
      target: targetWallet,
    }),
  },
);
const status = await requestJson(
  `${apiUrl}/v1/agents/${encodeURIComponent(credentials.agentKid)}/status`,
);
credentials = {
  ...credentials,
  payoutRail: payout.body?.rail ?? "x402",
  payoutHint: payout.body?.hint ?? null,
  payoutReceipt: payout.body?.receipt_ref ?? null,
  payoutRegisteredAt: new Date().toISOString(),
};
await writePrivateJson(credentials);

console.log(
  JSON.stringify(
    {
      registered: true,
      reused,
      agentKid: credentials.agentKid,
      operatorHandle: credentials.operatorHandle,
      identityMode: credentials.identityMode,
      emailVerified:
        status.body?.verification?.seals?.signal?.state === "sealed",
      claimEligibility: status.body?.agent?.claimEligibility ?? null,
      payoutStatus: status.body?.agent?.onboarding?.payout ?? null,
      payoutRail: credentials.payoutRail,
      payoutHint: credentials.payoutHint,
      payoutReceipt: credentials.payoutReceipt,
      credentialsPath,
    },
    null,
    2,
  ),
);
