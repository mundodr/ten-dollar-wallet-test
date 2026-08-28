import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://api.riner.io/api/v1";
const rpcUrl = "https://mainnet.base.org";
const targetWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const escrow = "0x5ce4d7fcdc2da5f714abc8fbd5f01239d1c6d0f0";
const transferTopic =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const credentials = JSON.parse(
  await readFile(path.resolve(".riner/credentials.json"), "utf8"),
);

async function json(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`Riner request failed (${response.status})`);
      }
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
    }
  }
  throw lastError ?? new Error("Riner request returned no response");
}

async function receipt(hash) {
  const body = await json(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionReceipt",
      params: [hash],
    }),
  });
  return body?.result ?? null;
}

const tokenBody = await json(`${baseUrl}/auth/agents/token`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    agent_id: credentials.agentId,
    api_key: credentials.apiKey,
  }),
});
const [agent, taskBody] = await Promise.all([
  json(`${baseUrl}/agents/${credentials.agentId}`, {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  }),
  json(`${baseUrl}/tasks?status=published&limit=100`),
]);

const exclusionPattern =
  /promot|community engagement|social media|reddit|twitter|discord|telegram|attract .*users|register .*agents?|post .*comments|referral|unsolicited|outreach/i;
const openTasks = await Promise.all(
  (taskBody.tasks ?? []).map(async (task) => {
    const chainReceipt = /^0x[0-9a-f]{64}$/i.test(task.escrow_tx ?? "")
      ? await receipt(task.escrow_tx)
      : null;
    const matchingDeposit = (chainReceipt?.logs ?? []).find((log) => {
      if (log.address?.toLowerCase() !== usdc) return false;
      if (log.topics?.[0]?.toLowerCase() !== transferTopic) return false;
      const recipient = `0x${String(log.topics?.[2] ?? "").slice(-40)}`.toLowerCase();
      const amount = BigInt(log.data ?? "0x0");
      return recipient === escrow && amount >= BigInt(Math.round(task.budget_amount * 1e6));
    });
    const text = `${task.title}\n${task.description}\n${task.output_spec?.description ?? ""}`;
    const exclusions = [];
    if (!matchingDeposit || chainReceipt?.status !== "0x1") {
      exclusions.push("escrow transfer is not independently verified");
    }
    if (exclusionPattern.test(text)) {
      exclusions.push("requires promotional, social, or unsolicited outreach activity");
    }
    return {
      id: task.id,
      title: task.title,
      budgetUsdc: task.budget_amount,
      selectionMode: task.selection_mode,
      escrowTx: task.escrow_tx,
      escrowVerified: Boolean(matchingDeposit && chainReceipt?.status === "0x1"),
      exclusions,
      actionable: exclusions.length === 0,
    };
  }),
);

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agentId: agent.id,
      agentName: agent.name,
      agentStatus: agent.status,
      walletAddress: agent.wallet_address,
      exactTargetWallet: agent.wallet_address?.toLowerCase() === targetWallet,
      openTaskCount: openTasks.length,
      actionableTasks: openTasks.filter((task) => task.actionable),
      excludedTasks: openTasks.filter((task) => !task.actionable),
      nextAction:
        openTasks.some((task) => task.actionable)
          ? "Review the independently funded, non-promotional task before applying."
          : "Keep monitoring for independently funded code, research, or data work.",
      countingPolicy:
        "Registration, applications, submissions, escrow deposits, and platform status do not count; only a matching Base-mainnet receipt at the target wallet counts.",
    },
    null,
    2,
  ),
);
