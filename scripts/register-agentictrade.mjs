import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://agentictrade.io";
const mailboxApi = "https://api.mail.tm";
const credentialsDir = path.resolve(".agentictrade");
const credentialsPath = path.join(credentialsDir, "credentials.json");
const verificationMessagePath = path.join(credentialsDir, "verification-message.json");
const mailbox = JSON.parse(await readFile(path.resolve(".moltjobs/mailbox.json"), "utf8"));
const cookieJar = new Map();

function cookieHeader() {
  return [...cookieJar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function collectCookies(response) {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  for (const setCookie of setCookies) {
    const [pair] = setCookie.split(";", 1);
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (value) cookieJar.set(name, value);
    else cookieJar.delete(name);
  }
}

async function fetchWithCookies(url, options = {}) {
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(url, {
        ...options,
        redirect: "manual",
        headers: {
          ...(cookieJar.size ? { Cookie: cookieHeader() } : {}),
          ...options.headers,
        },
      });
      collectCookies(response);
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  if (!response) throw lastError ?? new Error(`No response from ${new URL(url).host}`);
  return response;
}

async function follow(url, options = {}, maxRedirects = 5) {
  let current = url;
  let response = await fetchWithCookies(current, options);
  for (let index = 0; index < maxRedirects; index += 1) {
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) return response;
    current = new URL(location, current).toString();
    if (new URL(current).origin !== baseUrl) {
      throw new Error(`Refusing unexpected AgenticTrade redirect: ${new URL(current).origin}`);
    }
    response = await fetchWithCookies(current);
  }
  return response;
}

function collectionMembers(value) {
  if (Array.isArray(value)) return value;
  return value?.["hydra:member"] ?? value?.member ?? [];
}

async function mailboxRequest(route) {
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(`${mailboxApi}${route}`, {
        headers: { Authorization: `Bearer ${mailbox.token}`, Accept: "application/json" },
      });
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  if (!response) throw lastError ?? new Error(`No mailbox response for ${route}`);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Mailbox ${route} failed (${response.status})`);
  return body;
}

async function waitForVerificationMessage(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = collectionMembers(await mailboxRequest("/messages"));
    const summary = messages.find(
      (message) =>
        /agentictrade/i.test(message.from?.address ?? "") ||
        /agentictrade|verify your email/i.test(message.subject ?? ""),
    );
    if (summary) return mailboxRequest(`/messages/${summary.id}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return null;
}

try {
  const existing = JSON.parse(await readFile(credentialsPath, "utf8"));
  for (const [name, value] of Object.entries(existing.cookies ?? {})) cookieJar.set(name, value);
  const dashboard = await follow(`${baseUrl}/portal/dashboard`);
  console.log(
    JSON.stringify({
      reused: true,
      accountReachable: dashboard.ok,
      credentialsPath,
    }),
  );
  process.exit(0);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
await chmod(credentialsDir, 0o700);
const password = randomBytes(32).toString("base64url");
const registerPage = await follow(`${baseUrl}/portal/register`);
const registerHtml = await registerPage.text();
const csrfToken = registerHtml.match(/name="csrf_token"\s+value="([^"]+)"/)?.[1];
if (!csrfToken) throw new Error("AgenticTrade registration page returned no CSRF token");

const form = new URLSearchParams({
  display_name: "Ten Dollar Wallet Worker",
  email: mailbox.address,
  password,
  confirm_password: password,
  csrf_token: csrfToken,
  ref_code: "",
  promo_code: "",
});
const registration = await follow(`${baseUrl}/portal/register`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: form,
});
const registrationHtml = await registration.text();
if (!registration.ok || /registration failed|already registered|invalid csrf/i.test(registrationHtml)) {
  const message = registrationHtml.match(/class="[^" ]*(?:error|alert)[^" ]*"[^>]*>([^<]+)/i)?.[1];
  throw new Error(`AgenticTrade registration failed: ${message ?? registration.status}`);
}

const verificationMessage = await waitForVerificationMessage();
let verified = false;
if (verificationMessage) {
  await writeFile(
    verificationMessagePath,
    `${JSON.stringify(verificationMessage, null, 2)}\n`,
    { mode: 0o600 },
  );
  await chmod(verificationMessagePath, 0o600);
  const raw = [
    verificationMessage.text,
    ...(Array.isArray(verificationMessage.html)
      ? verificationMessage.html
      : [verificationMessage.html]),
  ]
    .filter(Boolean)
    .join("\n")
    .replaceAll("&amp;", "&");
  const verifyUrl = [...raw.matchAll(/https?:\/\/[^\s"'<>]+/g)]
    .map((match) => match[0])
    .find((url) => url.includes("agentictrade.io/portal/verify"));
  if (verifyUrl) {
    const verification = await follow(verifyUrl);
    verified = verification.ok;
  }
}

const credentials = {
  email: mailbox.address,
  password,
  cookies: Object.fromEntries(cookieJar),
  registeredAt: new Date().toISOString(),
  emailVerified: verified,
};
await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
await chmod(credentialsPath, 0o600);

console.log(
  JSON.stringify(
    {
      reused: false,
      registered: true,
      emailVerificationReceived: Boolean(verificationMessage),
      emailVerified: verified,
      credentialsPath,
    },
    null,
    2,
  ),
);
