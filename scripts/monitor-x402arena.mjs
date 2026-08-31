const arenaBaseUrl = "https://core.x402arena.gg";
const baseRpcUrl = "https://mainnet.base.org";
const targetWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const officialBaseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const services = [
  {
    agentId: "ten-dollar-python-security-review",
    endpoint:
      "https://payanagent.com/x402/kh7csa6y1atvzs35bneg89xx0d8dhm2d",
    expectedAmountAtomic: "5000000",
    expectedPriceUsdc: 5,
    probeBody: { code: "print('hello')", fileName: "sample.py" },
  },
  {
    agentId: "ten-dollar-api-acceptance-checklist",
    endpoint:
      "https://payanagent.com/x402/kh7ezjzt4etk8x1s908z7wngqn8d89hx",
    expectedAmountAtomic: "10000",
    expectedPriceUsdc: 0.01,
    probeBody: { input: "POST /v1/orders returns HTTP 201." },
  },
];

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
const [agentsResult, eventsResult, balanceResult, ...challengeResults] =
  await Promise.all([
    requestJson(`${arenaBaseUrl}/operator/agents`),
    requestJson(`${arenaBaseUrl}/operator/events?limit=200`),
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
    ...services.map((service) =>
      requestJson(service.endpoint, {
        method: "POST",
        body: JSON.stringify(service.probeBody),
      }),
    ),
  ]);

const agentRows = Array.isArray(agentsResult.body?.agents)
  ? agentsResult.body.agents
  : [];
const eventRows = Array.isArray(eventsResult.body?.events)
  ? eventsResult.body.events
  : Array.isArray(eventsResult.body)
    ? eventsResult.body
    : [];
const trackedIds = new Set(services.map((service) => service.agentId));
const arenaEvents = eventRows.filter((event) =>
  trackedIds.has(event?.agentId ?? event?.agent_id),
);
const monitoredServices = services.map((service, index) => {
  const arenaRow = agentRows.find(
    (row) => row?.agentId === service.agentId,
  );
  const challengeResult = challengeResults[index];
  const challenge = decodeChallenge(challengeResult);
  const payment = challenge?.accepts?.[0];
  const exactChallenge =
    challengeResult.status === 402 &&
    payment?.scheme === "exact" &&
    payment?.network === "eip155:8453" &&
    String(payment?.asset).toLowerCase() === officialBaseUsdc.toLowerCase() &&
    payment?.amount === service.expectedAmountAtomic &&
    String(payment?.payTo).toLowerCase() === targetWallet;
  const arenaExact =
    agentsResult.status === 200 &&
    arenaRow?.status === "active" &&
    Number(arenaRow?.priceUsdc) === service.expectedPriceUsdc;

  return {
    agentId: service.agentId,
    endpoint: service.endpoint,
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
    exact: arenaExact && exactChallenge,
  };
});
const allExact = monitoredServices.every((service) => service.exact);
const balanceHex = balanceResult.body?.result;
const targetUsdcAtomic =
  typeof balanceHex === "string" && balanceHex.startsWith("0x")
    ? BigInt(balanceHex)
    : null;

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      serviceCount: monitoredServices.length,
      allExact,
      services: monitoredServices,
      recentArenaEventCount: arenaEvents.length,
      recentArenaEvents: arenaEvents,
      targetOfficialBaseUsdcAtomic: targetUsdcAtomic?.toString() ?? null,
      targetOfficialBaseUsdc:
        targetUsdcAtomic === null ? null : Number(targetUsdcAtomic) / 1e6,
      nextAction:
        !allExact
          ? "Repair any free listing or live x402 challenge without spending user funds."
          : "Keep both direct-pay listings live and monitor for genuine third-party purchases.",
      countingPolicy:
        "Arena registration, queries, buyers, and self-reported revenue are discovery signals only. Never self-buy. Count only an independently verified Base-mainnet transfer to the disclosed target.",
    },
    null,
    2,
  ),
);
