import { createHmac, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://www.task-bounty.com";
const targetWallet = "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt";
const accountPath = path.resolve(".taskbounty/account.json");
const webhookPath = path.resolve(".taskbounty/webhook.json");
const publicUrl =
  "https://begins-greatly-badge-dealers.trycloudflare.com/taskbounty/webhook";

const account = JSON.parse(await readFile(accountPath, "utf8"));
if (
  !account.apiKey?.startsWith("tb_live_") ||
  !/^[0-9a-f-]{36}$/i.test(account.agentId ?? "") ||
  account.payoutAddress !== targetWallet ||
  account.payoutMethod !== "solana_usdc"
) {
  throw new Error("TaskBounty account state is incomplete or has a mismatched payout");
}

let webhook;
try {
  webhook = JSON.parse(await readFile(webhookPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (!webhook) {
  webhook = {
    publicUrl,
    secret: randomBytes(32).toString("hex"),
    createdAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(webhookPath), { recursive: true, mode: 0o700 });
  await writeFile(webhookPath, `${JSON.stringify(webhook, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(webhookPath, 0o600);
}
if (webhook.publicUrl !== publicUrl || !/^[0-9a-f]{64}$/.test(webhook.secret)) {
  throw new Error("Saved TaskBounty webhook configuration is invalid");
}

if (process.env.TASKBOUNTY_PREPARE_ONLY === "1") {
  console.log(
    JSON.stringify({ prepared: true, publicUrl, webhookPath, agentId: account.agentId }),
  );
  process.exit(0);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
    signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`TaskBounty returned HTTP ${response.status}`);
  }
  return body;
}

const testBody = JSON.stringify({ test: true, source: "local_configuration_probe" });
const testSignature = `sha256=${createHmac("sha256", webhook.secret)
  .update(testBody)
  .digest("hex")}`;
await request(publicUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-TaskBounty-Signature": testSignature,
  },
  body: testBody,
});

await request(`${baseUrl}/api/v1/solver/payout-method`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${account.apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ method: "solana_usdc", address: targetWallet }),
});

await request(`${baseUrl}/api/v1/agents/${account.agentId}`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${account.apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    notification_webhook_url: publicUrl,
    notification_webhook_secret: webhook.secret,
    notify_new_tasks: true,
  }),
});

webhook.registeredAt = new Date().toISOString();
webhook.agentId = account.agentId;
webhook.payoutMethod = "solana_usdc";
webhook.payoutAddress = targetWallet;
await writeFile(webhookPath, `${JSON.stringify(webhook, null, 2)}\n`, {
  mode: 0o600,
});
await chmod(webhookPath, 0o600);

console.log(
  JSON.stringify(
    {
      configured: true,
      agentId: account.agentId,
      agentSlug: account.agentSlug,
      publicUrl,
      payoutMethod: webhook.payoutMethod,
      payoutAddress: webhook.payoutAddress,
      exactTarget: webhook.payoutAddress === targetWallet,
      countingPolicy:
        "Registration, tasks, submissions, and platform status do not count without an independently verified Solana-mainnet target receipt.",
    },
    null,
    2,
  ),
);
