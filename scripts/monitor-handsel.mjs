import { readFile } from "node:fs/promises";
import path from "node:path";

const credentialsPath = path.resolve(".handsel/credentials.json");
const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
const platformUrl = credentials.platformUrl ?? "https://handsel-main.vercel.app";
const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const baseRpcUrl = "https://mainnet.base.org";
const knownReservedJobIds = new Set([17, 18, 19]);

async function request(route, options = {}) {
  const response = await fetch(`${platformUrl}${route}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Handsel ${options.method ?? "GET"} ${route} failed (${response.status}): ${body?.error ?? body?.message ?? "unknown error"}`,
    );
  }
  return body;
}

async function rpc(method, params) {
  const response = await fetch(baseRpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok || body.error || body.result == null) {
    throw new Error(`Base RPC ${method} failed: ${JSON.stringify(body.error ?? body)}`);
  }
  return body.result;
}

const [feed, wallet] = await Promise.all([
  request("/api/tasks"),
  request("/api/worker/wallet", {
    method: "POST",
    headers: { "X-Runtime-Secret": credentials.secret },
    body: JSON.stringify({ agent_id: credentials.agentId }),
  }),
]);

const address = wallet.address ?? credentials.smartAccountAddress;
if (!address) throw new Error("Handsel worker has no smart-account address");
const normalizedAddress = address.toLowerCase();
const balanceOfData =
  "0x70a08231" + normalizedAddress.slice(2).padStart(64, "0");
const [ethHex, usdcHex] = await Promise.all([
  rpc("eth_getBalance", [normalizedAddress, "latest"]),
  rpc("eth_call", [{ to: usdcAddress, data: balanceOfData }, "latest"]),
]);

const ethWei = BigInt(ethHex);
const usdcBaseUnits = BigInt(usdcHex);
const openTasks = Array.isArray(feed?.tasks)
  ? feed.tasks.filter((task) => task.status === "Open")
  : [];
const tasks = openTasks.map((task) => {
  const rewardUsd = Number(task.rewardUsd ?? 0);
  const bondUsd = rewardUsd * 0.05 + 0.03;
  const missingBrief = !task.description || !task.acceptanceCriteria;
  const reservedKnown = knownReservedJobIds.has(Number(task.id));
  return {
    id: String(task.id),
    title: task.title ?? null,
    rewardUsd,
    bondUsd: Number(bondUsd.toFixed(6)),
    minScore: task.minScore ?? null,
    verification: task.verification ?? null,
    reservedKnown,
    missingBrief,
    potentiallyActionable: !reservedKnown && !missingBrief && rewardUsd > 0,
  };
});
const minimumPotentialBond = tasks
  .filter((task) => task.potentiallyActionable)
  .reduce((min, task) => Math.min(min, task.bondUsd), Number.POSITIVE_INFINITY);
const ethReady = ethWei >= 50_000_000_000_000n;
const usdcReady =
  Number.isFinite(minimumPotentialBond) &&
  usdcBaseUnits >= BigInt(Math.ceil(minimumPotentialBond * 1_000_000));

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      environment: feed?.meta?.environment ?? null,
      chainId: feed?.meta?.chainId ?? null,
      realMoney: feed?.meta?.realMoney ?? null,
      agentId: credentials.agentId,
      workerAddress: address,
      balances: {
        ethWei: ethWei.toString(),
        eth: Number(ethWei) / 1e18,
        usdcBaseUnits: usdcBaseUnits.toString(),
        usdc: Number(usdcBaseUnits) / 1e6,
      },
      claimFunding: {
        gasFloorWei: "50000000000000",
        ethReady,
        minimumPotentialBondUsd: Number.isFinite(minimumPotentialBond)
          ? minimumPotentialBond
          : null,
        usdcReady,
      },
      openTaskCount: tasks.length,
      openRewardUsd: tasks.reduce((sum, task) => sum + task.rewardUsd, 0),
      potentiallyActionableCount: tasks.filter((task) => task.potentiallyActionable)
        .length,
      tasks,
      nextAction:
        ethReady && usdcReady
          ? "Review the potentially actionable briefs, then claim at most one truthful job."
          : "Monitor only; never fund the worker with user money or attempt a claim that requires a deposit.",
    },
    null,
    2,
  ),
);
