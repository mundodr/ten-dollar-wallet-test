import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://www.task-bounty.com";
const targetWallet = "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt";
const account = JSON.parse(
  await readFile(path.resolve(".taskbounty/account.json"), "utf8"),
);
const webhook = JSON.parse(
  await readFile(path.resolve(".taskbounty/webhook.json"), "utf8"),
);

async function fetchJson(url, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${account.apiKey}`,
        },
        signal: AbortSignal.timeout(25_000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`TaskBounty returned HTTP ${response.status}`);
      }
      return body;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError ?? new Error("TaskBounty returned no response");
}

const body = await fetchJson(`${baseUrl}/api/v1/tasks?limit=100`);
const tasks = Array.isArray(body?.data)
  ? body.data
  : Array.isArray(body?.tasks)
    ? body.tasks
    : [];
const fundedOpenTasks = tasks.filter((task) => {
  const status = String(task.status ?? "OPEN").toUpperCase();
  const funding = String(task.funding_status ?? "FUNDED").toUpperCase();
  return (
    status === "OPEN" &&
    funding === "FUNDED" &&
    Number(task.bounty_cents ?? task.bountyCents) >= 1_000
  );
});

let events = [];
try {
  const raw = await readFile(
    path.resolve(".taskbounty/webhook-events.ndjson"),
    "utf8",
  );
  events = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry?.event?.test !== true);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const exactPayout =
  account.payoutMethod === "solana_usdc" &&
  account.payoutAddress === targetWallet &&
  webhook.payoutMethod === "solana_usdc" &&
  webhook.payoutAddress === targetWallet;

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      accountEmail: account.email,
      agentId: account.agentId,
      agentName: account.agentName,
      agentSlug: account.agentSlug,
      payoutMethod: webhook.payoutMethod,
      payoutAddress: webhook.payoutAddress,
      exactPayout,
      webhookUrl: webhook.publicUrl,
      webhookConfigured: Boolean(webhook.registeredAt),
      publicTaskCount: tasks.length,
      fundedOpenTaskCount: fundedOpenTasks.length,
      fundedOpenTasks: fundedOpenTasks.map((task) => ({
        id: task.id,
        title: task.title,
        bountyCents: task.bounty_cents ?? task.bountyCents ?? null,
        language: task.language ?? null,
        complexity: task.complexity_tag ?? task.complexity ?? null,
        githubRepoUrl: task.github_repo_url ?? null,
        githubIssueUrl: task.github_issue_url ?? null,
        status: task.status ?? null,
        createdAt: task.created_at ?? null,
      })),
      genuineWebhookEventCount: events.length,
      latestWebhookEvent: events.at(-1) ?? null,
      nextAction:
        fundedOpenTasks.length > 0
          ? "Inspect the least-contested reproducible task and attempt one original regression-tested fix."
          : "Keep the signed webhook and authenticated task monitor active.",
      countingPolicy:
        "Task listings, access tokens, patches, verification, and platform earnings do not count without an independently verified Solana-mainnet target receipt.",
    },
    null,
    2,
  ),
);

if (!exactPayout || !webhook.registeredAt) {
  throw new Error("TaskBounty payout or webhook configuration is incomplete");
}
