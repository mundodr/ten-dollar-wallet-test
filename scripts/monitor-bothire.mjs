import { readFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://www.bothire.io/api";
const expectedWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const credentials = JSON.parse(
  await readFile(path.resolve(".bothire/credentials.json"), "utf8"),
);
const listings = JSON.parse(
  await readFile(path.resolve(".bothire/listings.json"), "utf8"),
);

if (credentials.wallet_address?.toLowerCase() !== expectedWallet) {
  throw new Error("BotHire payout address does not match the disclosed Base target");
}

async function getJson(url, authenticated = false) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(authenticated
        ? { Authorization: `Bearer ${credentials.api_key}` }
        : {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`BotHire request failed (${response.status}) for ${new URL(url).pathname}`);
  }
  return body;
}

const [stats, botSearch, hires] = await Promise.all([
  getJson(`${apiBase}/stats`),
  getJson(`${apiBase}/bots/search?keyword=${encodeURIComponent(credentials.name)}`),
  getJson(`${apiBase}/bots/${encodeURIComponent(credentials.bot_id)}/hires?role=provider`, true),
]);

const publicBot = (botSearch.bots ?? []).find(
  (bot) => bot._id === credentials.bot_id || bot.name === credentials.name,
);
if (!publicBot) throw new Error("Registered BotHire bot is not discoverable");
if (publicBot.wallet_address?.toLowerCase() !== expectedWallet) {
  throw new Error("Public BotHire bot exposes an unexpected payout wallet");
}

const hireRows = hires.hires ?? hires.data ?? (Array.isArray(hires) ? hires : []);
console.log(
  JSON.stringify(
    {
      botId: credentials.bot_id,
      botName: credentials.name,
      payoutAddress: publicBot.wallet_address,
      publicSkillCount: publicBot.skill_count ?? null,
      listingCount: listings.listings?.length ?? 0,
      providerHires: hireRows.length,
      activeHires: hireRows.filter((hire) => hire.status === "active").map((hire) => ({
        id: hire._id ?? hire.id,
        status: hire.status,
        postId: hire.post_id ?? hire.postId ?? null,
      })),
      completedHires: hireRows.filter((hire) => hire.status === "completed").length,
      marketplace: {
        bots: stats.total_bots,
        skills: stats.total_skills,
        hires: stats.total_hires,
        completedHires: stats.completed_hires,
        volumeUsdc: stats.total_volume_usdc,
      },
      paymentEvidence: "chain_required",
    },
    null,
    2,
  ),
);
