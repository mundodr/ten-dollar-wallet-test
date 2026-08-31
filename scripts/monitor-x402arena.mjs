const arenaBaseUrl = "https://core.x402arena.gg";
const baseRpcUrl = "https://mainnet.base.org";
const agentId = "ten-dollar-python-security-review";
const endpoint =
  "https://payanagent.com/x402/kh7csa6y1atvzs35bneg89xx0d8dhm2d";
const targetWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const officialBaseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const expectedAmountAtomic = "5000000";

async function requestJson(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, response, body };
  } catch (error) {
    return {
      ok: false,
      status: null,
      response: null,
      body: null,
      error: error.message,
    };
  }
}

function decodeChallenge(result) {
  const encoded = result.response?.headers.get("payment-required");
  if (encoded) {
    try {
      return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    } catch {
      // Fall through to the JSON response body.
    }
  }
  return result.body;
}

const balanceCallData = `0x70a08231${targetWallet.slice(2).padStart(64, "0")}`;
const [agentsResult, eventsResult, challengeResult, balanceResult] =
  await Promise.all([
    requestJson(`${arenaBaseUrl}/operator/agents`),
    requestJson(`${arenaBaseUrl}/operator/events?limit=200`),
    requestJson(endpoint, {
      method: "POST",
      body: JSON.stringify({ code: "print('hello')", fileName: "sample.py" }),
    }),
    requestJson(baseRpcUrl, {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          { to: officialBaseUsdc, data: balanceCallData },
          "latest",
        ],
      }),
    }),
  ]);

const arenaRow = (agentsResult.body?.agents ?? []).find(
  (row) => row?.agentId === agentId,
);
const arenaEvents = (eventsResult.body?.events ?? eventsResult.body ?? []).filter(
  (event) => event?.agentId === agentId || event?.agent_id === agentId,
);
const challenge = decodeChallenge(challengeResult);
const payment = challenge?.accepts?.[0];
const exactChallenge =
  challengeResult.status === 402 &&
  payment?.scheme === "exact" &&
  payment?.network === "eip155:8453" &&
  String(payment?.asset).toLowerCase() === officialBaseUsdc.toLowerCase() &&
  payment?.amount === expectedAmountAtomic &&
  String(payment?.payTo).toLowerCase() === targetWallet;
const arenaExact =
  agentsResult.status === 200 &&
  arenaRow?.status === "active" &&
  Number(arenaRow?.priceUsdc) === 5;
const balanceHex = balanceResult.body?.result;
const targetUsdcAtomic =
  typeof balanceHex === "string" && balanceHex.startsWith("0x")
    ? BigInt(balanceHex)
    : null;

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agentId,
      endpoint,
      arena: arenaRow
        ? {
            listed: true,
            exact: arenaExact,
            status: arenaRow.status ?? null,
            priceUsdc: arenaRow.priceUsdc ?? null,
            queryCount: arenaRow.queryCount ?? 0,
            uniqueBuyers: arenaRow.uniqueBuyers ?? 0,
            reportedRevenueUsdc: arenaRow.totalRevenue ?? 0,
            organicRevenueUsdc: arenaRow.organicRevenue ?? 0,
            houseRevenueUsdc: arenaRow.houseRevenue ?? 0,
          }
        : {
            listed: false,
            exact: false,
          },
      liveChallenge: {
        status: challengeResult.status,
        exact: exactChallenge,
        scheme: payment?.scheme ?? null,
        network: payment?.network ?? null,
        asset: payment?.asset ?? null,
        amountAtomic: payment?.amount ?? null,
        payTo: payment?.payTo ?? null,
      },
      recentArenaEventCount: arenaEvents.length,
      recentArenaEvents: arenaEvents,
      targetOfficialBaseUsdcAtomic: targetUsdcAtomic?.toString() ?? null,
      targetOfficialBaseUsdc:
        targetUsdcAtomic === null ? null : Number(targetUsdcAtomic) / 1e6,
      nextAction:
        !arenaExact || !exactChallenge
          ? "Repair the free listing or live x402 challenge without spending user funds."
          : "Keep the direct-pay listing live and monitor for a genuine third-party purchase.",
      countingPolicy:
        "Arena registration, queries, buyers, and self-reported revenue are discovery signals only. Never self-buy. Count only an independently verified Base-mainnet transfer to the disclosed target.",
    },
    null,
    2,
  ),
);
