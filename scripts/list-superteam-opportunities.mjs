import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://superteam.fun";
const credentialsPath = path.resolve(".superteam/credentials.json");
const snapshotPath = path.resolve(".superteam/listings.json");
const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));

const allItems = [];
const excludedIds = [];

for (let page = 0; page < 20; page += 1) {
  const params = new URLSearchParams({ take: "50" });
  for (const id of excludedIds) params.append("excludeIds[]", id);

  const response = await fetch(
    `${baseUrl}/api/agents/listings/live?${params.toString()}`,
    { headers: { Authorization: `Bearer ${credentials.apiKey}` } },
  );

  const batch = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Superteam listing request failed (${response.status}): ${JSON.stringify(batch)}`,
    );
  }
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
