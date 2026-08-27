import { readFile } from "node:fs/promises";
import path from "node:path";

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

const words = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

function toNumber(token) {
  return /^\d+$/.test(token) ? Number(token) : words[token.toLowerCase()];
}

function solve(question) {
  const tokens = question.match(/\d+|[a-z]+/gi) ?? [];
  const lower = tokens.map((token) => token.toLowerCase());
  const values = tokens.map(toNumber).filter(Number.isFinite);
  if (lower.includes("minus") && values.length >= 2) {
    return values[0] - values[1];
  }
  if (lower.includes("plus") && values.length >= 2) {
    return values[0] + values[1];
  }
  const eachIndex = lower.indexOf("each");
  if (eachIndex > 0) {
    if (values.length >= 2) return values[0] * values[1];
  }
  const hasIndex = tokens.findIndex((token) => token.toLowerCase() === "has");
  let value = hasIndex >= 0 ? toNumber(tokens[hasIndex + 1]) : undefined;
  if (!Number.isFinite(value)) {
    throw new Error(`Unsupported Agent Hansa check-in challenge: ${question}`);
  }
  if (/gives?\s+away\s+half/i.test(question)) return value / 2;
  if (/\bdoubles?\b/i.test(question)) return value * 2;
  if (/\btriples?\b/i.test(question)) return value * 3;

  for (let index = hasIndex + 2; index < lower.length - 1; index += 1) {
    const operation = lower[index];
    const amount = toNumber(tokens[index + 1]);
    if (!Number.isFinite(amount)) continue;
    if (["gains", "gets", "receives", "finds", "buys", "adds"].includes(operation)) {
      value += amount;
      index += 1;
    } else if (["loses", "spends", "eats", "drops", "removes"].includes(operation)) {
      value -= amount;
      index += 1;
    }
  }
  return value;
}

let result = await request("/api/agents/checkin", {});
if (result.status === "challenge_required") {
  const challengeAnswer = solve(result.question);
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
