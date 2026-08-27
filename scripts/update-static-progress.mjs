import { readFile, writeFile } from "node:fs/promises";

const SOL_ADDRESS = "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt";
const BNB_ADDRESS = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
const BSC_USDC = "0x8AC76a51cc950d9822D68b83Fe1Ad97B32Cd580d";
const PAGE = new URL("../docs/index.html", import.meta.url);

async function rpc(url, method, params) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
      const body = await response.json();
      if (body.error || body.result === undefined) throw new Error(`${method} RPC error`);
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError;
}

async function bscTokenBalance(contract) {
  const owner = BNB_ADDRESS.slice(2).padStart(64, "0");
  const value = await rpc(
    "https://bsc-dataseed.binance.org",
    "eth_call",
    [{ to: contract, data: `0x70a08231${owner}` }, "latest"],
  );
  return Number(BigInt(value)) / 1e18;
}

async function marketPrices() {
  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana,binancecoin&vs_currencies=usd",
      { signal: AbortSignal.timeout(12_000) },
    );
    if (!response.ok) throw new Error("price request failed");
    const data = await response.json();
    if (!data.solana?.usd || !data.binancecoin?.usd) throw new Error("price response incomplete");
    return { sol: data.solana.usd, bnb: data.binancecoin.usd };
  } catch {
    return { sol: 77.97, bnb: 709.65 };
  }
}

function replaceText(html, id, value) {
  const pattern = new RegExp(`(<[^>]+id="${id}"[^>]*>)[^<]*(</[^>]+>)`);
  if (!pattern.test(html)) throw new Error(`Missing page marker: ${id}`);
  return html.replace(pattern, `$1${value}$2`);
}

function currentText(html, id) {
  const match = html.match(new RegExp(`<[^>]+id="${id}"[^>]*>([^<]*)</[^>]+>`));
  if (!match) throw new Error(`Missing page marker: ${id}`);
  return match[1];
}

const [solRaw, solTokens, bnbRaw, bscUsdt, bscUsdc, prices] = await Promise.all([
  rpc("https://api.mainnet-beta.solana.com", "getBalance", [SOL_ADDRESS, { commitment: "confirmed" }]),
  rpc("https://api.mainnet-beta.solana.com", "getTokenAccountsByOwner", [SOL_ADDRESS, { mint: SOLANA_USDC_MINT }, { encoding: "jsonParsed", commitment: "confirmed" }]),
  rpc("https://bsc-dataseed.binance.org", "eth_getBalance", [BNB_ADDRESS, "latest"]),
  bscTokenBalance(BSC_USDT),
  bscTokenBalance(BSC_USDC),
  marketPrices(),
]);

const sol = solRaw.value / 1e9;
const bnb = Number(BigInt(bnbRaw)) / 1e18;
const solUsdc = solTokens.value.reduce(
  (sum, item) => sum + Number(item.account.data.parsed.info.tokenAmount.uiAmountString),
  0,
);
const stable = solUsdc + bscUsdt + bscUsdc;
const total = sol * prices.sol + bnb * prices.bnb + stable;
const percent = Math.min(100, total * 10);
const display = {
  total: `$${total.toFixed(2)}`,
  remaining: `$${Math.max(0, 10 - total).toFixed(2)} TO GO`,
  percent: `${percent.toFixed(1)}% FUNDED`,
  sol: sol.toFixed(6),
  bnb: bnb.toFixed(6),
  stable: stable.toFixed(2),
};

let html = await readFile(PAGE, "utf8");
if (
  currentText(html, "usd-total") === display.total &&
  currentText(html, "sol-balance") === display.sol &&
  currentText(html, "bnb-balance") === display.bnb &&
  currentText(html, "stable-balance") === display.stable
) {
  console.log("No balance change.");
  process.exit(0);
}

html = replaceText(html, "usd-total", display.total);
html = replaceText(html, "remaining", display.remaining);
html = replaceText(html, "percent", display.percent);
html = replaceText(html, "sol-balance", display.sol);
html = replaceText(html, "bnb-balance", display.bnb);
html = replaceText(html, "stable-balance", display.stable);
html = replaceText(html, "updated", `余额快照 · ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} CST · 区块浏览器为准`);
html = html.replace(/(<i id="progress-fill" style="width:)[^"]+(%">)/, `$1${Math.max(0.2, percent).toFixed(1)}$2`);
await writeFile(PAGE, html);

if (total >= 10) {
  await writeFile(new URL("../.goal-reached", import.meta.url), `Reached ${display.total} at ${new Date().toISOString()}\n`);
}

console.log(`Updated public progress to ${display.total}.`);
