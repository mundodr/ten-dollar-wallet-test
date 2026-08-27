import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const supabaseUrl = "https://mgvojndnifjbxvdxkdyd.supabase.co";
const publishableKey = "sb_publishable_T9Ruv1HSZ9Vx3uqbxY_ixg_aV_SPlBA";
const mailboxApi = "https://api.mail.tm";
const credentialsDir = path.resolve(".x402jobs");
const credentialsPath = path.join(credentialsDir, "credentials.json");
const mailbox = JSON.parse(
  await readFile(path.resolve(".moltjobs/mailbox.json"), "utf8"),
);

async function request(url, options = {}) {
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(20_000),
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
  return response;
}

async function supabase(route, options = {}) {
  const response = await request(`${supabaseUrl}${route}`, {
    ...options,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
      Accept: "application/json",
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

function collectionMembers(value) {
  if (Array.isArray(value)) return value;
  return value?.["hydra:member"] ?? value?.member ?? [];
}

async function mailboxRequest(route) {
  const response = await request(`${mailboxApi}${route}`, {
    headers: {
      Authorization: `Bearer ${mailbox.token}`,
      Accept: "application/json",
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Mailbox request failed (${response.status})`);
  return body;
}

async function waitForConfirmation(startedAt, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = collectionMembers(await mailboxRequest("/messages"));
    for (const summary of messages) {
      const createdAt = Date.parse(summary.createdAt ?? summary.created_at ?? 0);
      if (Number.isFinite(createdAt) && createdAt + 5_000 < startedAt) continue;
      if (!/confirm|verify|x402/i.test(summary.subject ?? "")) continue;
      const message = await mailboxRequest(`/messages/${summary.id}`);
      const raw = [
        message.text,
        ...(Array.isArray(message.html) ? message.html : [message.html]),
      ]
        .filter(Boolean)
        .join("\n")
        .replaceAll("&amp;", "&");
      const confirmationUrl = [...raw.matchAll(/https?:\/\/[^\s"'<>]+/g)]
        .map((match) => match[0])
        .find(
          (url) =>
            url.startsWith(`${supabaseUrl}/auth/v1/verify`) &&
            /redirect_to=.*x402\.jobs/i.test(url),
        );
      if (confirmationUrl) return confirmationUrl;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return null;
}

async function passwordSession(email, password) {
  return supabase("/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
await chmod(credentialsDir, 0o700);

try {
  const existing = JSON.parse(await readFile(credentialsPath, "utf8"));
  const session = await passwordSession(existing.email, existing.password);
  if (!session.response.ok || !session.body?.access_token) {
    throw new Error(`Existing x402.jobs login failed (${session.response.status})`);
  }
  const refreshed = {
    ...existing,
    userId: session.body.user?.id ?? existing.userId,
    accessToken: session.body.access_token,
    refreshToken: session.body.refresh_token,
    expiresAt: new Date(Date.now() + (session.body.expires_in ?? 3600) * 1_000).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeFile(credentialsPath, `${JSON.stringify(refreshed, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(credentialsPath, 0o600);
  console.log(
    JSON.stringify({
      reused: true,
      authenticated: true,
      userId: refreshed.userId,
      credentialsPath,
    }),
  );
  process.exit(0);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const password = randomBytes(32).toString("base64url");
const username = `tenwallet${randomBytes(3).toString("hex")}`;
const startedAt = Date.now();
const redirectTo = encodeURIComponent("https://www.x402.jobs/auth/callback");
const signup = await supabase(`/auth/v1/signup?redirect_to=${redirectTo}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: mailbox.address,
    password,
    data: { username },
  }),
});
if (!signup.response.ok || !signup.body?.id) {
  throw new Error(
    `x402.jobs signup failed (${signup.response.status}): ${signup.body?.msg ?? signup.body?.message ?? "unknown"}`,
  );
}

const confirmationUrl = await waitForConfirmation(startedAt);
if (!confirmationUrl) throw new Error("x402.jobs confirmation email did not arrive");
const confirmation = await request(confirmationUrl, { redirect: "manual" });
const confirmationLocation = confirmation.headers.get("location");
const confirmed =
  confirmation.status >= 300 &&
  confirmation.status < 400 &&
  confirmationLocation &&
  new URL(confirmationLocation).hostname.endsWith("x402.jobs");
if (!confirmed) {
  throw new Error(`x402.jobs email confirmation failed (${confirmation.status})`);
}

const session = await passwordSession(mailbox.address, password);
if (!session.response.ok || !session.body?.access_token) {
  throw new Error(`x402.jobs login failed after confirmation (${session.response.status})`);
}
const credentials = {
  email: mailbox.address,
  password,
  username,
  userId: session.body.user?.id ?? signup.body.id,
  accessToken: session.body.access_token,
  refreshToken: session.body.refresh_token,
  expiresAt: new Date(Date.now() + (session.body.expires_in ?? 3600) * 1_000).toISOString(),
  emailVerified: true,
  registeredAt: new Date().toISOString(),
};
await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, {
  mode: 0o600,
});
await chmod(credentialsPath, 0o600);

console.log(
  JSON.stringify(
    {
      reused: false,
      registered: true,
      emailVerified: true,
      userId: credentials.userId,
      credentialsPath,
    },
    null,
    2,
  ),
);
