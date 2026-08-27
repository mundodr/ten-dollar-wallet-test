import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://superteam.fun";
const credentialsPath = path.resolve(".superteam/credentials.json");
const snapshotPath = path.resolve(".superteam/listings.json");
const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));

const allItems = [];
const excludedIds = [];

async function fetchJsonWithRetry(url, options, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(
          `Superteam listing request failed (${response.status}): ${JSON.stringify(body)}`,
        );
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return body;
    } catch (error) {
      lastError = error;
      if (error.retryable === false || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

for (let page = 0; page < 20; page += 1) {
  const params = new URLSearchParams({ take: "50" });
  for (const id of excludedIds) params.append("excludeIds[]", id);

  const batch = await fetchJsonWithRetry(
    `${baseUrl}/api/agents/listings/live?${params.toString()}`,
    { headers: { Authorization: `Bearer ${credentials.apiKey}` } },
  );
  if (!Array.isArray(batch) || batch.length === 0) break;

  allItems.push(...batch);
  excludedIds.push(...batch.map((item) => item.id));
  if (batch.length < 50) break;
}

const payload = allItems;

await writeFile(snapshotPath, `${JSON.stringify(payload, null, 2)}\n`, {
  mode: 0o600,
});

const items = payload;
const now = Date.now();
const liveItems = items.filter(
  (item) => item.deadline && new Date(item.deadline).getTime() >= now,
);

function pick(item, names) {
  for (const name of names) {
    if (item?.[name] !== undefined && item?.[name] !== null) return item[name];
  }
  return null;
}

console.log(
  JSON.stringify(
    {
      count: liveItems.length,
      expiredCount: items.length - liveItems.length,
      responseKeys: payload && !Array.isArray(payload) ? Object.keys(payload) : [],
      itemKeys: items[0] ? Object.keys(items[0]) : [],
      listings: liveItems.map((item) => ({
        id: pick(item, ["id", "listingId"]),
        slug: pick(item, ["slug"]),
        title: pick(item, ["title"]),
        type: pick(item, ["type", "listingType"]),
        agentAccess: pick(item, ["agentAccess"]),
        deadline: pick(item, ["deadline", "submissionDeadline", "endsAt"]),
        reward: pick(item, [
          "reward",
          "rewards",
          "compensation",
          "totalReward",
          "prizePool",
        ]),
        token: pick(item, ["token", "currency", "rewardToken"]),
        sponsor: pick(item, ["sponsor", "company", "organization"]),
      })),
      snapshotPath,
    },
    null,
    2,
  ),
);
