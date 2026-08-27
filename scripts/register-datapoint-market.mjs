import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

const mailboxApi = "https://api.mail.tm";
const apiUrl = "https://api.datapoint.market";
const privateDir = path.resolve(".datapointmarket");
const mailboxPath = path.join(privateDir, "mailbox.json");
const credentialsPath = path.join(privateDir, "credentials.json");

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `${new URL(url).hostname} returned HTTP ${response.status}: ${body?.detail ?? body?.message ?? "unknown"}`,
    );
  }
  return { response, body };
}

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await chmod(filePath, 0o600);
}

async function loadOrCreateMailbox() {
  try {
    const mailbox = JSON.parse(await readFile(mailboxPath, "utf8"));
    const check = await fetch(`${mailboxApi}/messages`, {
      headers: { Authorization: `Bearer ${mailbox.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (check.ok) return mailbox;
  } catch {
    // Create a fresh task-specific mailbox below.
  }

  const { body: domains } = await requestJson(`${mailboxApi}/domains`);
  const domain = (Array.isArray(domains)
    ? domains
    : (domains?.["hydra:member"] ?? domains?.member ?? [])
  ).find(
    (candidate) => candidate?.isActive && !candidate?.isPrivate,
  );
  if (!domain?.domain) throw new Error("Mail.tm returned no active public domain");

  const address = `ten-dollar-datapoint-${randomBytes(5).toString("hex")}@${domain.domain}`;
  const password = randomBytes(24).toString("base64url");
  await requestJson(`${mailboxApi}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, password }),
  });
  const { body: auth } = await requestJson(`${mailboxApi}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, password }),
  });
  const mailbox = {
    address,
    password,
    token: auth.token,
    provider: "mail.tm",
    createdAt: new Date().toISOString(),
  };
  await writePrivateJson(mailboxPath, mailbox);
  return mailbox;
}

function members(body) {
  return Array.isArray(body) ? body : (body?.["hydra:member"] ?? body?.member ?? []);
}

function extractToken(message) {
  const content = [
    message?.text ?? "",
    ...(Array.isArray(message?.html) ? message.html : [message?.html ?? ""]),
  ]
    .join("\n")
    .replaceAll("&amp;", "&");
  const urls = content.match(/https?:\/\/[^\s<>"']+/g) ?? [];
  for (const rawUrl of urls) {
    try {
      const url = new URL(rawUrl.replace(/[).,]+$/, ""));
      if (!url.hostname.endsWith("datapoint.market")) continue;
      const token = url.searchParams.get("token");
      if (token) return token;
    } catch {
      // Ignore malformed email links.
    }
  }
  return null;
}

async function waitForMagicLink(mailbox, requestedAt, timeoutMs = 75_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await requestJson(`${mailboxApi}/messages`, {
      headers: { Authorization: `Bearer ${mailbox.token}` },
    });
    const summary = members(body).find(
      (candidate) =>
        new Date(candidate.createdAt ?? 0).getTime() >= requestedAt - 5_000 &&
        /datapoint|magic|sign.?in|login/i.test(
          `${candidate.subject ?? ""} ${candidate.from?.address ?? ""}`,
        ),
    );
    if (summary?.id) {
      const { body: message } = await requestJson(
        `${mailboxApi}/messages/${summary.id}`,
        { headers: { Authorization: `Bearer ${mailbox.token}` } },
      );
      const token = extractToken(message);
      if (token) return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error("Timed out waiting for datapoint.market magic-link email");
}

function cookieHeader(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  const raw = values.length ? values : [response.headers.get("set-cookie")].filter(Boolean);
  return raw.map((value) => value.split(";", 1)[0]).join("; ");
}

await mkdir(privateDir, { recursive: true, mode: 0o700 });
const mailbox = await loadOrCreateMailbox();
const requestedAt = Date.now();
await requestJson(`${apiUrl}/auth/magic-link/request`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: mailbox.address,
    return_to: "https://datapoint.market/dashboard",
  }),
});
const token = await waitForMagicLink(mailbox, requestedAt);
const verification = await requestJson(`${apiUrl}/auth/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token }),
});
const cookie = cookieHeader(verification.response);
if (!cookie) throw new Error("datapoint.market verification returned no session cookie");

const keyCreation = await requestJson(`${apiUrl}/dashboard/automation-keys`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ name: "wallet-test-monitor" }),
});
const automationKey = keyCreation.body?.key ?? keyCreation.body?.automation_key?.key;
if (!automationKey?.startsWith("empk_")) {
  throw new Error("datapoint.market returned no usable automation key");
}
const { body: account } = await requestJson(`${apiUrl}/auth/me`, {
  headers: { Authorization: `Bearer ${automationKey}` },
});
const credentials = {
  email: mailbox.address,
  automationKey,
  automationKeyId: keyCreation.body?.id ?? keyCreation.body?.automation_key?.id ?? null,
  provider: account?.provider ?? account,
  emailVerified: true,
  registeredAt: new Date().toISOString(),
};
await writePrivateJson(credentialsPath, credentials);

console.log(
  JSON.stringify(
    {
      registered: true,
      email: mailbox.address,
      emailVerified: true,
      providerId: credentials.provider?.id ?? null,
      providerSlug: credentials.provider?.slug ?? null,
      automationKeyStored: true,
    },
    null,
    2,
  ),
);
