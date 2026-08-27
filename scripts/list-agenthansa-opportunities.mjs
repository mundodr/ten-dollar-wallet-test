import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://www.agenthansa.com";
const credentials = JSON.parse(
  await readFile(path.resolve(".agenthansa/credentials.json"), "utf8"),
);

async function request(route, authenticated = false) {
  let response;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      response = await fetch(`${baseUrl}${route}`, {
        headers: authenticated
          ? { Authorization: `Bearer ${credentials.apiKey}` }
          : {},
      });
      break;
    } catch (error) {
      if (attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Agent Hansa request failed for ${route} (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return body;
}

const [profile, feed, communityTasks, collectiveBounties, quests] =
  await Promise.all([
    request("/api/agents/me", true),
    request("/api/agents/feed", true),
    request("/api/community/tasks"),
    request("/api/collective/bounties/public"),
    request("/api/alliance-war/quests"),
  ]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  for (const key of ["items", "tasks", "bounties", "quests", "results", "data"]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function summarize(items) {
  const actionableStatuses = new Set([
    "active",
    "available",
    "in_progress",
    "open",
    "published",
  ]);
  return asArray(items)
    .filter((item) => actionableStatuses.has(String(item.status).toLowerCase()))
    .map((item) => ({
      id: item.id,
      title: item.title ?? item.name,
      status: item.status,
      reward:
        item.reward_usd ??
        item.reward ??
        item.reward_amount ??
        item.total_reward ??
        item.pay_usd ??
        null,
      deadline: item.deadline ?? item.ends_at ?? item.end_at ?? null,
      submissionCount:
        item.submission_count ??
        item.submissions_count ??
        item.participant_count ??
        null,
    }));
}

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      profile: {
        id: profile.id,
        name: profile.name,
        alliance: profile.alliance ?? null,
        walletAddress: profile.wallet_address ?? null,
        balance:
          profile.balance ??
          profile.payout_balance ??
          profile.total_earnings ??
          null,
        pendingEngagements: asArray(profile.pending_engagements).length,
      },
      feed: {
        summary: feed?.summary ?? null,
        urgentCount: asArray(feed?.urgent).length,
        engagementCount: asArray(feed?.engagement).length,
        questCount: asArray(feed?.quests).length,
        communityTaskCount: asArray(feed?.community_tasks).length,
        merchantOfferCount: feed?.offers?.count ?? 0,
      },
      communityTasks: summarize(communityTasks),
      collectiveBounties: summarize(collectiveBounties),
      quests: summarize(quests),
    },
    null,
    2,
  ),
);
