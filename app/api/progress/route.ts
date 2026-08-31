const SOL_ADDRESS = "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt";
const BNB_ADDRESS = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const BASE_ADDRESS = BNB_ADDRESS;
const TRON_ADDRESS = "TVa6sSVC4B8fKq3S8qDLKQSaYRvhkPgRBk";
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
const BSC_USDC = "0x8AC76a51cc950d9822D68b83Fe1Ad97B32Cd580d";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TRON_USDT = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";
const GOAL_USD = 100;

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`RPC ${response.status}`);
  const payload = await response.json() as { result?: T; error?: unknown };
  if (payload.error || payload.result === undefined) throw new Error("RPC error");
  return payload.result;
}

async function safeNumber(task: Promise<number>) {
  try { return await task; } catch { return 0; }
}

async function solBalance() {
  const result = await rpc<{ value: number }>(
    "https://api.mainnet-beta.solana.com",
    "getBalance",
    [SOL_ADDRESS, { commitment: "confirmed" }],
  );
  return result.value / 1_000_000_000;
}

async function solUsdcBalance() {
  const result = await rpc<{ value: Array<{ account: { data: { parsed: { info: { tokenAmount: { uiAmountString: string } } } } } }> }>(
    "https://api.mainnet-beta.solana.com",
    "getTokenAccountsByOwner",
    [SOL_ADDRESS, { mint: SOLANA_USDC_MINT }, { encoding: "jsonParsed", commitment: "confirmed" }],
  );
  return result.value.reduce((sum, item) => sum + Number(item.account.data.parsed.info.tokenAmount.uiAmountString), 0);
}

async function evmBalanceOf(rpcUrl: string, address: string, contract: string, decimals: number) {
  const encodedOwner = address.slice(2).padStart(64, "0");
  const result = await rpc<string>(
    rpcUrl,
    "eth_call",
    [{ to: contract, data: `0x70a08231${encodedOwner}` }, "latest"],
  );
  return Number(BigInt(result)) / 10 ** decimals;
}

async function bnbBalance() {
  const result = await rpc<string>(
    "https://bsc-dataseed.binance.org",
    "eth_getBalance",
    [BNB_ADDRESS, "latest"],
  );
  return Number(BigInt(result)) / 1e18;
}

async function baseEthBalance() {
  const result = await rpc<string>(
    "https://mainnet.base.org",
    "eth_getBalance",
    [BASE_ADDRESS, "latest"],
  );
  return Number(BigInt(result)) / 1e18;
}

async function tronBalances() {
  const response = await fetch(
    `https://api.trongrid.io/v1/accounts/${TRON_ADDRESS}?only_confirmed=true`,
    { signal: AbortSignal.timeout(7000) },
  );
  if (!response.ok) throw new Error(`TRON account request ${response.status}`);
  const body = await response.json() as {
    success?: boolean;
    data?: Array<{ balance?: number; trc20?: Array<Record<string, string>> }>;
  };
  if (body.success !== true || !Array.isArray(body.data)) throw new Error("TRON response incomplete");
  const account = body.data[0];
  if (!account) return { trx: 0, tronUsdt: 0 };
  const rawUsdt = (account.trc20 ?? []).reduce(
    (sum, balances) => sum + BigInt(balances[TRON_USDT] ?? 0),
    0n,
  );
  return {
    trx: Number(account.balance ?? 0) / 1e6,
    tronUsdt: Number(rawUsdt) / 1e6,
  };
}

async function prices() {
  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana,binancecoin,ethereum,tron&vs_currencies=usd",
      { signal: AbortSignal.timeout(7000) },
    );
    if (!response.ok) throw new Error("Price service unavailable");
    const data = await response.json() as {
      solana?: { usd?: number };
      binancecoin?: { usd?: number };
      ethereum?: { usd?: number };
      tron?: { usd?: number };
    };
    if (!data.solana?.usd || !data.binancecoin?.usd || !data.ethereum?.usd || !data.tron?.usd) {
      throw new Error("Missing price");
    }
    return {
      sol: data.solana.usd,
      bnb: data.binancecoin.usd,
      eth: data.ethereum.usd,
      trx: data.tron.usd,
      estimated: false,
    };
  } catch {
    return { sol: 77.97, bnb: 709.65, eth: 2390, trx: 0.31, estimated: true };
  }
}

export async function GET() {
  const [sol, solUsdc, bnb, bscUsdt, bscUsdc, baseEth, baseUsdc, tron, market] = await Promise.all([
    safeNumber(solBalance()),
    safeNumber(solUsdcBalance()),
    safeNumber(bnbBalance()),
    safeNumber(evmBalanceOf("https://bsc-dataseed.binance.org", BNB_ADDRESS, BSC_USDT, 18)),
    safeNumber(evmBalanceOf("https://bsc-dataseed.binance.org", BNB_ADDRESS, BSC_USDC, 18)),
    safeNumber(baseEthBalance()),
    safeNumber(evmBalanceOf("https://mainnet.base.org", BASE_ADDRESS, BASE_USDC, 6)),
    tronBalances().catch(() => ({ trx: 0, tronUsdt: 0 })),
    prices(),
  ]);
  const usdTotal =
    sol * market.sol +
    bnb * market.bnb +
    baseEth * market.eth +
    tron.trx * market.trx +
    solUsdc +
    bscUsdt +
    bscUsdc +
    baseUsdc +
    tron.tronUsdt;

  return Response.json(
    {
      balances: { sol, solUsdc, bnb, bscUsdt, bscUsdc, baseEth, baseUsdc, trx: tron.trx, tronUsdt: tron.tronUsdt },
      prices: market,
      usdTotal,
      goalUsd: GOAL_USD,
      percent: Math.min(100, (usdTotal / GOAL_USD) * 100),
      updatedAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "public, max-age=30, s-maxage=60" } },
  );
}
