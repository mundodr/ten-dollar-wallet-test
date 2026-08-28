import { execFileSync } from "node:child_process";
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const workspace = path.resolve(import.meta.dirname, "..");
const taskmarket = "/home/lenovo/.npm-global/bin/taskmarket";
const targetAddress = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const workerAddress = "0xbb8f5dA5e6E14BD221e720D8e1798Fb8A5c7EA71";
const baseChainId = 8453;
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const baseRpc = "https://mainnet.base.org";
const transferTopic =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const stateDirectory = path.join(workspace, ".taskmarket-withdrawals");
const lockPath = path.join(stateDirectory, "withdraw.lock");

function run(args, timeout = 90_000) {
  const stdout = execFileSync(taskmarket, args, {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  });
  const parsed = JSON.parse(stdout);
  if (parsed?.ok !== true) throw new Error(`Taskmarket rejected: ${stdout}`);
  return parsed.data;
}

async function rpc(method, params) {
  const response = await fetch(baseRpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Base RPC returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`Base RPC error: ${body.error.message}`);
  return body.result;
}

async function confirmedReceipt(txHash, attempts = 12) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
    if (receipt) return receipt;
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
  throw new Error(`Base receipt was not confirmed in time: ${txHash}`);
}

function paddedTopic(address) {
  return `0x${address.toLowerCase().slice(2).padStart(64, "0")}`;
}

await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
let lock;
try {
  lock = await open(lockPath, "wx", 0o600);
} catch (error) {
  if (error.code === "EEXIST") {
    console.log(JSON.stringify({ status: "withdrawal-already-running" }, null, 2));
    process.exit(0);
  }
  throw error;
}

async function withdrawIfAvailable() {
  const withdrawal = run(["wallet", "get-withdrawal-address"]);
  if (withdrawal.withdrawalAddress?.toLowerCase() !== targetAddress) {
    throw new Error("Taskmarket withdrawal address does not match the approved Base target");
  }
  if (
    Number(withdrawal.usdcDomain?.chainId) !== baseChainId ||
    withdrawal.usdcDomain?.verifyingContract?.toLowerCase() !== baseUsdc.toLowerCase()
  ) {
    throw new Error("Taskmarket USDC domain is not official Base USDC");
  }

  const balance = run(["wallet", "balance"]);
  if (balance.address?.toLowerCase() !== workerAddress.toLowerCase()) {
    throw new Error("Taskmarket worker wallet identity drifted");
  }
  const amountBaseUnits = BigInt(balance.balanceBaseUnits ?? "0");
  if (amountBaseUnits <= 0n) {
    console.log(
      JSON.stringify(
        {
          status: "no-withdrawable-usdc",
          balanceBaseUnits: amountBaseUnits.toString(),
          withdrawalAddress: withdrawal.withdrawalAddress,
        },
        null,
        2,
      ),
    );
    return;
  }

  const result = run(["withdraw", balance.balanceUsdc], 240_000);
  if (result.to?.toLowerCase() !== targetAddress) {
    throw new Error("Taskmarket withdrawal response target mismatch");
  }
  if (BigInt(result.amountBaseUnits) !== amountBaseUnits) {
    throw new Error("Taskmarket withdrawal response amount mismatch");
  }
  if (!/^0x[0-9a-f]{64}$/i.test(result.txHash ?? "")) {
    throw new Error("Taskmarket withdrawal response omitted a transaction hash");
  }

  const receipt = await confirmedReceipt(result.txHash);
  if (receipt.status !== "0x1") throw new Error("Taskmarket withdrawal reverted on Base");
  const transfer = (receipt.logs ?? []).find(
    (log) =>
      log.address?.toLowerCase() === baseUsdc.toLowerCase() &&
      log.topics?.[0]?.toLowerCase() === transferTopic &&
      log.topics?.[1]?.toLowerCase() === paddedTopic(workerAddress) &&
      log.topics?.[2]?.toLowerCase() === paddedTopic(targetAddress) &&
      BigInt(log.data ?? "0x0") === amountBaseUnits,
  );
  if (!transfer) {
    throw new Error("Exact official-USDC transfer was not found in the Base receipt");
  }

  const evidence = {
    status: "withdrawn-and-chain-verified",
    verifiedAt: new Date().toISOString(),
    workerAddress,
    targetAddress,
    amountBaseUnits: amountBaseUnits.toString(),
    amountUsdc: balance.balanceUsdc,
    txHash: result.txHash,
    blockNumber: receipt.blockNumber,
    tokenContract: transfer.address,
    transactionStatus: receipt.status,
  };
  await writeFile(
    path.join(stateDirectory, `${Date.now()}-${result.txHash.slice(2, 10)}.json`),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(evidence, null, 2));
}

try {
  await withdrawIfAvailable();
} finally {
  await lock.close();
  await rm(lockPath, { force: true });
}
