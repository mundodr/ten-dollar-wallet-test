import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://zentience.org/marketplace";
const targetAddress = "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt";
const privateDir = path.resolve(".zentience");
const credentialsPath = path.join(privateDir, "credentials.json");

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function requestJson(route, options = {}) {
  const response = await fetch(`${apiBase}${route}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { nonJsonResponse: text.slice(0, 500) };
  }
  if (!response.ok || body?.success === false) {
    throw new Error(
      `Zentience ${options.method ?? "GET"} ${route} failed (${response.status}): ${body?.message ?? body?.error ?? "unknown error"}`,
    );
  }
  return body?.data ?? body;
}

function listFrom(data, key) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[key])) return data[key];
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

async function main() {
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  await chmod(privateDir, 0o700);

// Do not create an account against a parked or misrouted custom domain. A
// successful public task-list read is the liveness gate for registration.
  const publicTasks = await requestJson("/tasks?status=open");
  let credentials = await readJsonIfPresent(credentialsPath);

  if (!credentials) {
    const registered = await requestJson("/agents/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Ten Dollar API Worker",
      bio:
        "Deterministic API acceptance-criteria, code review, small data transformation, and public-source research worker.",
      capabilities: ["development", "research", "data-analysis"],
      website: "https://github.com/mundodr/ten-dollar-wallet-test",
      walletAddress: targetAddress,
    }),
    });
    const agent = registered?.agent ?? registered;
    const apiKey = registered?.api_key ?? registered?.apiKey;
    const agentId = agent?.id ?? registered?.agent_id;
    if (!apiKey || !agentId) {
      throw new Error("Zentience registration returned no agent ID or API key");
    }
    credentials = {
      agentId,
      apiKey,
      targetAddress,
      registeredAt: new Date().toISOString(),
    };
    await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, {
      mode: 0o600,
    });
    await chmod(credentialsPath, 0o600);
  }

  if (credentials.targetAddress !== targetAddress) {
    throw new Error("Saved Zentience credentials do not match the locked Solana target");
  }

  const me = await requestJson("/agents/me", {
    headers: { "x-zent-api-key": credentials.apiKey },
  });
  const agent = me?.agent ?? me;
  const walletAddress =
    agent?.walletAddress ?? agent?.wallet_address ?? agent?.wallet ?? null;
  const exactWallet = walletAddress === targetAddress;
  const tasks = listFrom(publicTasks, "tasks");

  console.log(
    JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agentId: credentials.agentId,
      name: agent?.name ?? null,
      walletAddress,
      exactWallet,
      totalEarned: agent?.totalEarned ?? agent?.total_earned ?? null,
      openTaskCount: tasks.length,
      openTasks: tasks.slice(0, 30).map((task) => ({
        id: task?.id ?? null,
        title: task?.title ?? null,
        status: task?.status ?? null,
        budgetUsd: task?.budget ?? task?.budget_usd ?? null,
        escrowTxHash:
          task?.escrow_tx_hash ?? task?.payment_tx_hash ?? task?.funding_tx_hash ?? null,
        deadline: task?.deadline ?? task?.expires_at ?? null,
      })),
      countingPolicy:
        "Registering and bidding are not funds. Work requires independently verifiable funded escrow, and only a matching Solana mainnet payout to the locked target counts.",
    },
    null,
    2,
    ),
  );

  if (!exactWallet) throw new Error("Zentience payout wallet does not match the target");
}

main().catch((error) => {
  console.error(error?.message ?? String(error));
  process.exitCode = 1;
});
