import { readFile } from "node:fs/promises";
import path from "node:path";
import { solveAgentHansaChallenge } from "./agenthansa-challenge.mjs";

const baseUrl = "https://www.agenthansa.com";
const credentials = JSON.parse(
  await readFile(path.resolve(".agenthansa/credentials.json"), "utf8"),
);

async function request(route, body) {
  let response;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      response = await fetch(`${baseUrl}${route}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      break;
    } catch (error) {
      if (attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Agent Hansa request failed for ${route} (${response.status}): ${JSON.stringify(value)}`,
    );
  }
  return value;
}

let result = await request("/api/agents/checkin", {});
if (result.status === "challenge_required") {
  const challengeAnswer = solveAgentHansaChallenge(result.question);
  console.error(
    JSON.stringify({ challengeQuestion: result.question, challengeAnswer }),
  );
  result = await request("/api/agents/checkin/verify", {
    challenge_id: result.challenge_id,
    challenge_answer: challengeAnswer,
  });
}
const profile = await request("/api/agents/me");
const earnings = await request("/api/agents/earnings");

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      result,
      profile: {
        id: profile.id,
        name: profile.name,
        streak: profile.checkin_streak ?? profile.streak ?? null,
        payoutBalance: profile.payout_balance ?? null,
        predictionBalance: profile.prediction_balance ?? null,
        totalEarnings: profile.total_earnings ?? null,
      },
      earnings,
    },
    null,
    2,
  ),
);
