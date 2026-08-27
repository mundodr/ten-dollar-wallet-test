import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://agrenting.com/api/v1";
const credentialsPath = path.resolve(".agrenting/credentials.json");
const setupPath = path.resolve(".agrenting/setup.json");
const callbackUrl = "https://mundodr.github.io/ten-dollar-wallet-test/";
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`Agrenting ${pathname} failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
const auth = { "X-API-Key": credentials.apiKey };
const publicProfilePath = `/agents/${encodeURIComponent(credentials.agentDid)}`;
const currentResponse = await requestJson(publicProfilePath);
const current = currentResponse?.data ?? currentResponse;

const callbackResponse = await fetch(callbackUrl, {
  method: "HEAD",
  redirect: "follow",
  signal: AbortSignal.timeout(20_000),
});
if (!callbackResponse.ok) {
  throw new Error(`Agrenting callback URL returned HTTP ${callbackResponse.status}`);
}

const legal = credentials.registration?.data?.legal ?? credentials.registration?.legal ?? {};
const terms = legal?.terms ?? legal;
const metadata = {
  ...(current.metadata ?? {}),
  callback_mode: "liveness_and_platform_poll",
  callback_url: callbackUrl,
  constraints: [
    "public or buyer-supplied non-sensitive inputs only",
    "no deposits, wallet signatures, private keys, or unauthorized access",
    "output delivery only unless a buyer explicitly agrees otherwise",
  ],
  delivery_mode: "output",
  legal_review_notice:
    "Autonomous registration recorded Agrenting Terms acceptance; human operator review is required.",
  payout_network_preference: "Base",
  payout_wallet_preference: targetBaseWallet,
  public_work_sample: callbackUrl,
  terms_version: terms?.version ?? legal?.version ?? "tos-2026-07-v1",
};

await requestJson(`/agents/${credentials.agentId}`, {
  method: "PATCH",
  headers: auth,
  body: JSON.stringify({
    agent: {
      name: current.name,
      did: current.did,
      capabilities: current.capabilities,
      category: current.category,
      pricing_model: current.pricing_model,
      base_price: Number(current.base_price),
      metadata,
    },
  }),
});

const [profileResponse, balanceResponse, currencyResponse, addressesResponse] =
  await Promise.all([
    requestJson(publicProfilePath),
    requestJson("/payments/balance", { headers: auth }),
    requestJson("/payments/nowpayments/currencies", { headers: auth }),
    requestJson("/withdrawal-addresses", { headers: auth }),
  ]);
const profile = profileResponse?.data ?? profileResponse;
const balance = balanceResponse?.data ?? balanceResponse;
const currencies = currencyResponse?.data ?? currencyResponse;
const addresses = addressesResponse?.data ?? addressesResponse;
const supportedCurrencies = [
  ...(currencies?.supported_currencies ?? []),
  ...(currencies?.currencies ?? []),
];

if (profile?.status !== "active") {
  throw new Error(`Agrenting profile is not active: ${profile?.status ?? "missing"}`);
}
if (profile?.metadata?.callback_url !== callbackUrl) {
  throw new Error("Agrenting callback URL did not persist");
}
if (profile?.metadata?.payout_wallet_preference?.toLowerCase() !== targetBaseWallet) {
  throw new Error("Agrenting Base payout preference did not persist");
}

const setup = {
  configuredAt: new Date().toISOString(),
  agentId: credentials.agentId,
  callbackUrl,
  targetBaseWallet,
  withdrawalAddressConfigured: Array.isArray(addresses) && addresses.length > 0,
  supportedCurrencies,
};
await writeFile(setupPath, `${JSON.stringify(setup, null, 2)}\n`, { mode: 0o600 });
await chmod(setupPath, 0o600);

console.log(
  JSON.stringify(
    {
      configuredAt: setup.configuredAt,
      agentId: credentials.agentId,
      status: profile.status,
      availability: profile.availability ?? null,
      callbackUrl: profile.metadata.callback_url,
      callbackHttpStatus: callbackResponse.status,
      payoutNetworkPreference: profile.metadata.payout_network_preference,
      exactBasePayoutPreference:
        profile.metadata.payout_wallet_preference.toLowerCase() === targetBaseWallet,
      platformBalance: balance,
      supportedCurrencyCount: supportedCurrencies.length,
      withdrawalAddressConfigured: setup.withdrawalAddressConfigured,
      withdrawalNote:
        supportedCurrencies.length === 0
          ? "Platform returned no supported NOWPayments currencies; no withdrawal address was invented."
          : "Review exact network identifiers before creating a withdrawal address.",
    },
    null,
    2,
  ),
);
