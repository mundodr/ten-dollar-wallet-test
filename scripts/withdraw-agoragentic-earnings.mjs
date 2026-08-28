import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://agoragentic.com/api";
const rpcUrl = "https://mainnet.base.org";
const targetWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const transferTopic =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const credentialsPath = path.resolve(".agoragentic/credentials.json");
const payoutStatePath = path.resolve(".agoragentic/payout.json");

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function api(pathname, { method = "GET", body, apiKey } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Agoragentic ${pathname} failed (${response.status}): ${payload?.error ?? payload?.message ?? "unknown error"}`,
    );
  }
  return payload;
}

async function receipt(hash) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionReceipt",
      params: [hash],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Base RPC failed (${response.status})`);
  return (await response.json()).result ?? null;
}

function transactionHash(value) {
  const candidates = [
    value?.tx_hash,
    value?.txHash,
    value?.transaction_hash,
    value?.transactionHash,
    value?.hash,
  ];
  return candidates.find((candidate) => /^0x[0-9a-f]{64}$/i.test(candidate ?? "")) ?? null;
}

function verifyTransfer(chainReceipt, minimumAtomic) {
  if (chainReceipt?.status !== "0x1") return false;
  return (chainReceipt.logs ?? []).some((log) => {
    if (log.address?.toLowerCase() !== usdc) return false;
    if (log.topics?.[0]?.toLowerCase() !== transferTopic) return false;
    const recipient = `0x${String(log.topics?.[2] ?? "").slice(-40)}`.toLowerCase();
    return recipient === targetWallet && BigInt(log.data ?? "0x0") >= minimumAtomic;
  });
}

const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
if (credentials.targetWallet?.toLowerCase() !== targetWallet) {
  throw new Error("Agoragentic payout target does not match the approved Base address");
}

let localState = (await exists(payoutStatePath))
  ? JSON.parse(await readFile(payoutStatePath, "utf8"))
  : null;
const [wallet, payoutStatus, health] = await Promise.all([
  api("/wallet", { apiKey: credentials.apiKey }),
  api("/withdraw/status", { apiKey: credentials.apiKey }),
  api("/health", { apiKey: null }),
]);

if (!localState?.transactionHash) {
  const latest = Array.isArray(payoutStatus.withdrawals)
    ? payoutStatus.withdrawals.find((item) => transactionHash(item))
    : null;
  if (latest) {
    localState = {
      transactionHash: transactionHash(latest),
      amountUsdc: Number(latest.amount ?? latest.amount_usdc ?? 0),
      targetWallet,
      adoptedAt: new Date().toISOString(),
      verified: false,
    };
    await writeFile(payoutStatePath, `${JSON.stringify(localState, null, 2)}\n`, {
      mode: 0o600,
    });
  }
}

if (localState?.transactionHash && !localState.verified) {
  const chainReceipt = await receipt(localState.transactionHash);
  const minimumAtomic = BigInt(Math.floor(Number(localState.amountUsdc ?? 0) * 1e6));
  const verified = minimumAtomic > 0n && verifyTransfer(chainReceipt, minimumAtomic);
  if (verified) {
    localState.verified = true;
    localState.verifiedAt = new Date().toISOString();
    await writeFile(payoutStatePath, `${JSON.stringify(localState, null, 2)}\n`, {
      mode: 0o600,
    });
  }
  console.log(
    JSON.stringify({
      status: verified ? "verified-target-receipt" : "awaiting-target-receipt",
      transactionHash: localState.transactionHash,
      amountUsdc: localState.amountUsdc,
      targetWallet,
      verified,
    }),
  );
  process.exit(0);
}

const withdrawable = Number(
  wallet.withdrawable ?? wallet.withdrawable_usdc ?? payoutStatus.current_balance ?? 0,
);
const pending = (payoutStatus.withdrawals ?? []).some((item) =>
  /pending|processing|submitted/i.test(String(item.status ?? "")),
);
const custodyReady =
  health.checks?.platform_custody_freeze?.outbound_enabled === true;
const signerReady =
  health.checks?.platform_outbound_signer?.outbound_enabled === true &&
  health.checks?.platform_outbound_signer?.signer_ready === true;

if (withdrawable < 1 || pending || !custodyReady || !signerReady) {
  console.log(
    JSON.stringify({
      status: "no-payout",
      withdrawableUsdc: withdrawable,
      minimumUsdc: 1,
      pendingWithdrawal: pending,
      custodyReady,
      signerReady,
      targetWallet,
    }),
  );
  process.exit(0);
}

const amountUsdc = Math.floor(withdrawable * 1e6) / 1e6;
const payout = await api("/withdraw", {
  method: "POST",
  apiKey: credentials.apiKey,
  body: { amount: amountUsdc, destination_address: targetWallet },
});
const txHash = transactionHash(payout);
localState = {
  transactionHash: txHash,
  amountUsdc,
  targetWallet,
  requestedAt: new Date().toISOString(),
  verified: false,
};
await writeFile(payoutStatePath, `${JSON.stringify(localState, null, 2)}\n`, {
  mode: 0o600,
});
console.log(
  JSON.stringify({
    status: txHash ? "payout-submitted" : "payout-submitted-without-hash",
    transactionHash: txHash,
    amountUsdc,
    targetWallet,
    verified: false,
  }),
);
