import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://agentictrade.io";
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const credentialsPath = path.resolve(".agentictrade/credentials.json");
const tokenResponsePath = path.resolve(".agentictrade/token-response.html");
const providerKeyResponsePath = path.resolve(".agentictrade/provider-key-response.json");
const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
const cookieJar = new Map(Object.entries(credentials.cookies ?? {}));

function cookieHeader() {
  return [...cookieJar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function collectCookies(response) {
  for (const setCookie of response.headers.getSetCookie?.() ?? []) {
    const [pair] = setCookie.split(";", 1);
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (value) cookieJar.set(name, value);
    else cookieJar.delete(name);
  }
}

async function request(route, options = {}) {
  const response = await fetch(new URL(route, baseUrl), {
    ...options,
    redirect: "manual",
    headers: {
      Accept: "text/html,application/json",
      ...(cookieJar.size ? { Cookie: cookieHeader() } : {}),
      ...options.headers,
    },
  });
  collectCookies(response);
  return response;
}

async function requestFollowing(route, options = {}, maxRedirects = 5) {
  let current = route;
  let response = await request(current, options);
  for (let index = 0; index < maxRedirects; index += 1) {
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) return response;
    const next = new URL(location, new URL(current, baseUrl));
    if (next.origin !== baseUrl) throw new Error(`Refusing redirect to ${next.origin}`);
    current = next.toString();
    response = await request(current);
  }
  return response;
}

async function persistCookies() {
  credentials.cookies = Object.fromEntries(cookieJar);
  await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(credentialsPath, 0o600);
}

async function loadAuthenticatedSettings() {
  let response = await requestFollowing("/portal/settings");
  let html = await response.text();
  if (!/name="csrf_token"/.test(html) || /\/portal\/login/.test(response.url)) {
    const login = await requestFollowing("/portal/login");
    const loginHtml = await login.text();
    const csrfToken = loginHtml.match(/name="csrf_token"\s+value="([^"]+)"/)?.[1];
    if (!login.ok || !csrfToken) throw new Error(`Could not load AgenticTrade login (${login.status})`);
    const result = await requestFollowing("/portal/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrf_token: csrfToken,
        email: credentials.email,
        password: credentials.password,
      }),
    });
    const resultHtml = await result.text();
    if (!result.ok || /Invalid email or password/i.test(resultHtml)) {
      throw new Error(`AgenticTrade login failed (${result.status})`);
    }
    await persistCookies();
    response = await requestFollowing("/portal/settings");
    html = await response.text();
  }
  return { response, html };
}

function tokenFrom(text) {
  const decoded = text
    .replaceAll("&amp;", "&")
    .replaceAll("&#34;", '"')
    .replaceAll("&#39;", "'");
  return decoded.match(/(?:acf|pat)_[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16,}/)?.[0] ?? null;
}

async function validateToken(token) {
  if (!token) return { ok: false, status: null };
  const response = await fetch(`${baseUrl}/api/v1/provider/dashboard`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  return {
    ok: response.ok,
    status: response.status,
    body: response.ok ? await response.json().catch(() => null) : null,
  };
}

async function apiRequest(route, token, options = {}) {
  return fetch(new URL(route, baseUrl), {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...options.headers,
    },
  });
}

let token = credentials.providerToken ?? null;
let validation = await validateToken(token);

if (!validation.ok) {
  let { response: settings, html: settingsHtml } = await loadAuthenticatedSettings();
  let csrfToken = settingsHtml.match(/name="csrf_token"\s+value="([^"]+)"/)?.[1];
  if (!settings.ok || !csrfToken) {
    throw new Error(`Could not load AgenticTrade settings (${settings.status})`);
  }

  if (/action="\/portal\/revoke-api-token"/i.test(settingsHtml)) {
    const revocation = await requestFollowing("/portal/revoke-api-token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf_token: csrfToken }),
    });
    if (![200, 302, 303].includes(revocation.status)) {
      throw new Error(`Could not revoke inaccessible AgenticTrade token (${revocation.status})`);
    }
    await persistCookies();
    ({ response: settings, html: settingsHtml } = await loadAuthenticatedSettings());
    csrfToken = settingsHtml.match(/name="csrf_token"\s+value="([^"]+)"/)?.[1];
    if (
      !settings.ok ||
      !csrfToken ||
      /action="\/portal\/revoke-api-token"/i.test(settingsHtml) ||
      !/action="\/portal\/api-token"/i.test(settingsHtml)
    ) {
      throw new Error("AgenticTrade token revocation did not take effect");
    }
  }

  const response = await request("/portal/api-token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf_token: csrfToken }),
  });
  const responseText = await response.text();
  await writeFile(tokenResponsePath, responseText, { mode: 0o600 });
  await chmod(tokenResponsePath, 0o600);
  token = tokenFrom(responseText);

  const location = response.headers.get("location");
  if (!token && location) {
    const landing = await request(location);
    const landingText = await landing.text();
    await writeFile(tokenResponsePath, landingText, { mode: 0o600 });
    await chmod(tokenResponsePath, 0o600);
    token = tokenFrom(landingText);
  }
  if (!token) {
    throw new Error(
      `AgenticTrade generated no retrievable provider token (${response.status}, redirect=${Boolean(location)})`,
    );
  }

  validation = await validateToken(token);
  if (!validation.ok) {
    throw new Error(`AgenticTrade provider token rejected (${validation.status})`);
  }
}

credentials.cookies = Object.fromEntries(cookieJar);
credentials.providerToken = token;
credentials.providerTokenValidatedAt = new Date().toISOString();

let keysResponse = await apiRequest("/api/v1/provider/keys", token);
let keysBody = await keysResponse.json().catch(() => null);
if (!keysResponse.ok) throw new Error(`Could not inspect AgenticTrade provider keys (${keysResponse.status})`);
let walletKey = (keysBody?.keys ?? []).find(
  (key) => key.wallet_address?.toLowerCase() === targetBaseWallet.toLowerCase(),
);

if (!walletKey) {
  const creation = await apiRequest("/api/v1/keys", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "provider", rate_limit: 60, wallet_address: targetBaseWallet }),
  });
  const creationBody = await creation.json().catch(() => null);
  await writeFile(providerKeyResponsePath, `${JSON.stringify(creationBody, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(providerKeyResponsePath, 0o600);
  if (!creation.ok) {
    throw new Error(`Could not create wallet-bound AgenticTrade provider key (${creation.status})`);
  }
  const keyId = creationBody?.key_id ?? creationBody?.id;
  const secret = creationBody?.secret ?? creationBody?.key_secret;
  const fullToken =
    creationBody?.api_key ?? creationBody?.token ?? (keyId && secret ? `${keyId}:${secret}` : null);
  if (fullToken) credentials.walletProviderToken = fullToken;

  keysResponse = await apiRequest("/api/v1/provider/keys", token);
  keysBody = await keysResponse.json().catch(() => null);
  walletKey = (keysBody?.keys ?? []).find(
    (key) => key.wallet_address?.toLowerCase() === targetBaseWallet.toLowerCase(),
  );
}

if (!walletKey) throw new Error("AgenticTrade did not retain the Base payout wallet");
credentials.payoutWallet = targetBaseWallet;
credentials.walletProviderKeyId = walletKey.key_id;
await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
await chmod(credentialsPath, 0o600);

console.log(
  JSON.stringify({
    providerTokenReady: true,
    providerTokenValidated: validation.ok,
    providerDashboardReachable: validation.status === 200,
    payoutWalletConfigured: walletKey.wallet_address === targetBaseWallet,
    credentialsPath,
  }),
);
