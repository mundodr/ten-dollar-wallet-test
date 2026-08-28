import fs from "node:fs/promises";
import path from "node:path";
import { createPublicClient, formatEther, formatUnits, http } from "viem";
import { polygon } from "viem/chains";

const apiBase = "https://agentxchange.io/api/v1";
const stateDirectory = path.resolve(".agentxchange");
const credentialsPath = path.join(stateDirectory, "credentials.json");
const statusPath = path.join(stateDirectory, "status.json");
const usdcAddress = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

async function fetchJson(resource) {
  const response = await fetch(`${apiBase}${resource}`, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      accept: "application/json",
      "user-agent": "ten-dollar-wallet-worker/1.0",
    },
  });
  const raw = await response.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = { raw: raw.slice(0, 1000) };
  }
  return { ok: response.ok, status: response.status, body };
}

function records(body, keys) {
  if (Array.isArray(body)) return body;
  for (const key of keys) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

const credentials = JSON.parse(await fs.readFile(credentialsPath, "utf8"));
const workerWallet = credentials.wallet;
const targetWallet = credentials.forwardingTarget;
const client = createPublicClient({
  chain: polygon,
  transport: http("https://polygon-bor-rpc.publicnode.com"),
});

const routes = {
  profile: `/agent/${workerWallet}`,
  tasks: `/agent/${workerWallet}/tasks?limit=100&offset=0`,
  earnings: `/agent/${workerWallet}/earnings`,
  rewards: `/rewards/${workerWallet}`,
  services: "/services?limit=100&offset=0",
  availableTasks: "/tasks/available?limit=100&offset=0",
  bounties: "/bounties?status=open&limit=100&offset=0",
  needed: "/board/needed",
  stats: "/stats",
};
const api = Object.fromEntries(
  await Promise.all(
    Object.entries(routes).map(async ([name, resource]) => [name, await fetchJson(resource)]),
  ),
);

const [workerPol, workerUsdc, targetPol, targetUsdc] = await Promise.all([
  client.getBalance({ address: workerWallet }),
  client.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [workerWallet],
  }),
  client.getBalance({ address: targetWallet }),
  client.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [targetWallet],
  }),
]);

const available = records(api.availableTasks.body, ["tasks", "items", "results"]);
const bounties = records(api.bounties.body, ["bounties", "items", "results"]);
const services = records(api.services.body, ["services", "items", "results"]);
const disallowed =
  /\b(deposit|stake|bond|kyc|identity|passport|phone|captcha|follow|retweet|like|discord|telegram|outreach|cold[- ]?email|private key|seed phrase|credential|production access)\b/i;
const candidates = [...available, ...bounties].filter((item) => {
  const text = JSON.stringify(item);
  const value = Number(
    item?.budget_usdc ?? item?.reward_usdc ?? item?.price_usdc ?? item?.budget ?? 0,
  );
  return value > 0 && !disallowed.test(text);
});

const snapshot = {
  checkedAt: new Date().toISOString(),
  workerWallet,
  forwardingTarget: targetWallet,
  onchain: {
    chain: "Polygon",
    worker: {
      pol: formatEther(workerPol),
      nativeUsdc: formatUnits(workerUsdc, 6),
    },
    target: {
      pol: formatEther(targetPol),
      nativeUsdc: formatUnits(targetUsdc, 6),
    },
  },
  platform: api,
  ownServices: services.filter(
    (item) => item?.agent_wallet?.toLowerCase() === workerWallet.toLowerCase(),
  ),
  safeCandidateCount: candidates.length,
  safeCandidates: candidates,
  accountingNote:
    "Platform database balances and states are not evidence of receipt. Polygon balances are independently queried on-chain; only value at an exact goal address can complete the goal.",
};

await fs.writeFile(statusPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
  mode: 0o600,
});
await fs.chmod(statusPath, 0o600);

console.log(
  JSON.stringify(
    {
      checkedAt: snapshot.checkedAt,
      workerWallet,
      forwardingTarget: targetWallet,
      onchain: snapshot.onchain,
      profile: api.profile,
      tasks: api.tasks,
      earnings: api.earnings,
      rewards: api.rewards,
      ownServices: snapshot.ownServices,
      availableTaskCount: available.length,
      bountyCount: bounties.length,
      safeCandidateCount: candidates.length,
      safeCandidates: candidates,
    },
    null,
    2,
  ),
);
