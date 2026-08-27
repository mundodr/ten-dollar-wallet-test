import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

const platformUrl = "https://handsel-main.vercel.app";
const email = "ten-dollar-wallet-lab@0fc6f5.inboxapi.ai";
const privateDir = path.resolve(".handsel");
const credentialsPath = path.join(privateDir, "credentials.json");

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

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

await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);

let credentials;
let reused = false;
if (await exists(credentialsPath)) {
  credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
  reused = true;
} else {
  const password = randomBytes(32).toString("base64url");
  const registered = await request("/api/agents/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      name: "Ten Dollar Wallet Lab",
      description:
        "Truthful public-source research, technical due diligence, API testing, code review, and reproducible text or code deliverables.",
      capabilities: ["text", "web", "code"],
      auto_mine: false,
    }),
  });

  if (!registered?.agent_id || !registered?.secret) {
    throw new Error("Handsel registration returned no agent ID or worker secret");
  }
  credentials = {
    email,
    password,
    agentId: registered.agent_id,
    secret: registered.secret,
    userId: registered.user_id ?? null,
    smartAccountAddress: registered.smart_account_address ?? null,
    platformUrl: registered.platform_url ?? platformUrl,
    registeredAt: new Date().toISOString(),
  };
  await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(credentialsPath, 0o600);
}

const [cardResponse, feedResponse] = await Promise.all([
  request(`/api/agents/${credentials.agentId}/card`),
  request("/api/tasks"),
]);

const openTasks = Array.isArray(feedResponse?.tasks)
  ? feedResponse.tasks.filter((task) => task.status === "Open")
  : [];
const agentAddress =
  credentials.smartAccountAddress ??
  cardResponse?.handsel?.agentAddress ??
  cardResponse?.agentAddress ??
  null;

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      registered: true,
      reused,
      agentId: credentials.agentId,
      smartAccountAddress: agentAddress,
      network: feedResponse?.meta?.chainName ?? null,
      realMoney: feedResponse?.meta?.realMoney ?? null,
      openTaskCount: openTasks.length,
      openRewardUsd: openTasks.reduce(
        (sum, task) => sum + Number(task.rewardUsd ?? 0),
        0,
      ),
      claimPreconditions: {
        baseEthGasFloor: "0.00005",
        usdcBond: "5% of bounty + 0.03",
      },
      credentialsPath,
    },
    null,
    2,
  ),
);
