import { readFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://agrenting.com/api/v1";
const credentialsPath = path.resolve(".agrenting/credentials.json");
const callbackUrl = "https://mundodr.github.io/ten-dollar-wallet-test/";
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
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
const [
  profileResponse,
  pendingHiringsResponse,
  pendingTasksResponse,
  balanceResponse,
  currenciesResponse,
  addressesResponse,
  callbackResponse,
] = await Promise.all([
  requestJson(`/agents/${encodeURIComponent(credentials.agentDid)}`),
  requestJson("/hirings/pending", { headers: auth }),
  requestJson("/tasks/pending?limit=100", { headers: auth }),
  requestJson("/payments/balance", { headers: auth }),
  requestJson("/payments/nowpayments/currencies", { headers: auth }),
  requestJson("/withdrawal-addresses", { headers: auth }),
  fetch(callbackUrl, {
    method: "HEAD",
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  }),
]);

const profile = profileResponse?.data ?? profileResponse;
const pendingHirings = pendingHiringsResponse?.data ?? [];
const taskData = pendingTasksResponse?.data ?? pendingTasksResponse;
const pendingTasks = taskData?.tasks ?? [];
const balance = balanceResponse?.data ?? balanceResponse;
const currencies = currenciesResponse?.data ?? currenciesResponse;
const addresses = addressesResponse?.data ?? addressesResponse;
const supportedCurrencies = [
  ...(currencies?.supported_currencies ?? []),
  ...(currencies?.currencies ?? []),
];

const exactBasePreference =
  profile?.metadata?.payout_wallet_preference?.toLowerCase() === targetBaseWallet;
const callbackMatches = profile?.metadata?.callback_url === callbackUrl;
if (profile?.status !== "active" || !exactBasePreference || !callbackMatches) {
  throw new Error("Agrenting profile status or payout/callback metadata drifted");
}
if (!callbackResponse.ok) {
  throw new Error(`Agrenting callback returned HTTP ${callbackResponse.status}`);
}

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agentId: credentials.agentId,
      did: credentials.agentDid,
      status: profile.status,
      availability: profile.availability ?? null,
      exactBasePayoutPreference: exactBasePreference,
      withdrawalAddressConfigured: Array.isArray(addresses) && addresses.length > 0,
      supportedCurrencyCount: supportedCurrencies.length,
      callbackOnline: callbackResponse.ok,
      callbackHttpStatus: callbackResponse.status,
      totalEarnings: profile.total_earnings ?? "0",
      totalTasksCompleted: profile.total_tasks_completed ?? 0,
      platformBalance: balance,
      pendingHiringCount: Array.isArray(pendingHirings) ? pendingHirings.length : 0,
      pendingTaskCount: Array.isArray(pendingTasks) ? pendingTasks.length : 0,
      pendingTasks: pendingTasks.map((task) => ({
        id: task.id,
        capability: task.capability ?? null,
        price: task.price ?? task.amount ?? null,
        status: task.status ?? null,
      })),
      note:
        "Agrenting balances are platform records only; only a matching target-chain transfer counts toward the goal.",
    },
    null,
    2,
  ),
);
