const SOL_ADDRESS = "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt";
const BNB_ADDRESS = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
const BSC_USDC = "0x8AC76a51cc950d9822D68b83Fe1Ad97B32Cd580d";

async function rpc(url, method, params) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const data = await response.json();
  if (data.error) throw new Error("RPC error");
  return data.result;
}

async function tokenBalance(contract) {
  const owner = BNB_ADDRESS.slice(2).padStart(64, "0");
  const value = await rpc("https://bsc-dataseed.binance.org", "eth_call", [{ to: contract, data: `0x70a08231${owner}` }, "latest"]);
  return Number(BigInt(value)) / 1e18;
}

async function safe(task, fallback) {
  try { return await task; } catch { return fallback; }
}

async function refresh() {
  try {
    const [solRaw, solTokens, bnbRaw, usdt, usdc, prices] = await Promise.all([
      safe(rpc("https://api.mainnet-beta.solana.com", "getBalance", [SOL_ADDRESS, { commitment: "confirmed" }]), { value: 0 }),
      safe(rpc("https://api.mainnet-beta.solana.com", "getTokenAccountsByOwner", [SOL_ADDRESS, { mint: USDC_MINT }, { encoding: "jsonParsed", commitment: "confirmed" }]), { value: [] }),
      safe(rpc("https://bsc-dataseed.binance.org", "eth_getBalance", [BNB_ADDRESS, "latest"]), "0x0"),
      safe(tokenBalance(BSC_USDT), 0),
      safe(tokenBalance(BSC_USDC), 0),
      safe(fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana,binancecoin&vs_currencies=usd").then(r => r.ok ? r.json() : Promise.reject()), { solana: { usd: 77.97 }, binancecoin: { usd: 709.65 } }),
    ]);
    const sol = Number(solRaw?.value || 0) / 1e9;
    const bnb = bnbRaw ? Number(BigInt(bnbRaw)) / 1e18 : 0;
    const solAccounts = Array.isArray(solTokens?.value) ? solTokens.value : [];
    const solUsdc = solAccounts.reduce((sum, item) => sum + Number(item.account.data.parsed.info.tokenAmount.uiAmountString), 0);
    const stable = solUsdc + usdt + usdc;
    const total = sol * (prices?.solana?.usd || 77.97) + bnb * (prices?.binancecoin?.usd || 709.65) + stable;
    const pct = Math.min(100, total * 10);
    document.querySelector("#usd-total").textContent = `$${total.toFixed(2)}`;
    document.querySelector("#remaining").textContent = `$${Math.max(0, 10 - total).toFixed(2)} TO GO`;
    document.querySelector("#percent").textContent = `${pct.toFixed(1)}% FUNDED`;
    document.querySelector("#progress-fill").style.width = `${Math.max(.2, pct)}%`;
    document.querySelector("#sol-balance").textContent = sol.toFixed(6);
    document.querySelector("#bnb-balance").textContent = bnb.toFixed(6);
    document.querySelector("#stable-balance").textContent = stable.toFixed(2);
    document.querySelector("#updated").textContent = `链上更新 · ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
  } catch (error) {
    document.querySelector("#updated").textContent = "实时查询暂不可用；请使用链上核验链接。";
  }
}

document.querySelectorAll("[data-copy]").forEach(button => button.addEventListener("click", async () => {
  const original = button.textContent;
  await navigator.clipboard.writeText(document.querySelector(`#${button.dataset.copy}`).textContent);
  button.textContent = "已复制 · COPIED";
  setTimeout(() => { button.textContent = original; }, 1600);
}));

refresh();
