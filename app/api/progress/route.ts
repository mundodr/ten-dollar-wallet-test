const SOL_ADDRESS = "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt";
const BNB_ADDRESS = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
const BSC_USDC = "0x8AC76a51cc950d9822D68b83Fe1Ad97B32Cd580d";

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

async function bscBalanceOf(contract: string) {
  const encodedOwner = BNB_ADDRESS.slice(2).padStart(64, "0");
  const result = await rpc<string>(
    "https://bsc-dataseed.binance.org",
    "eth_call",
    [{ to: contract, data: `0x70a08231${encodedOwner}` }, "latest"],
  );
  return Number(BigInt(result)) / 1e18;
}

async function bnbBalance() {
  const result = await rpc<string>(
    "https://bsc-dataseed.binance.org",
    "eth_getBalance",
    [BNB_ADDRESS, "latest"],
  );
  return Number(BigInt(result)) / 1e18;
}

async function prices() {
  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana,binancecoin&vs_currencies=usd",
      { signal: AbortSignal.timeout(7000) },
    );
    if (!response.ok) throw new Error("Price service unavailable");
    const data = await response.json() as { solana?: { usd?: number }; binancecoin?: { usd?: number } };
    if (!data.solana?.usd || !data.binancecoin?.usd) throw new Error("Missing price");
    return { sol: data.solana.usd, bnb: data.binancecoin.usd, estimated: false };
  } catch {
    return { sol: 77.97, bnb: 709.65, estimated: true };
  }
}

export async function GET() {
  const [sol, solUsdc, bnb, bscUsdt, bscUsdc, market] = await Promise.all([
    safeNumber(solBalance()),
    safeNumber(solUsdcBalance()),
    safeNumber(bnbBalance()),
    safeNumber(bscBalanceOf(BSC_USDT)),
    safeNumber(bscBalanceOf(BSC_USDC)),
    prices(),
  ]);
  const usdTotal = sol * market.sol + bnb * market.bnb + solUsdc + bscUsdt + bscUsdc;

  return Response.json(
    {
      balances: { sol, solUsdc, bnb, bscUsdt, bscUsdc },
      prices: market,
      usdTotal,
      percent: Math.min(100, (usdTotal / 10) * 100),
      updatedAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "public, max-age=30, s-maxage=60" } },
  );
}
