import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://www.agenthansa.com";
const credentialsDir = path.resolve(".agenthansa");
const credentialsPath = path.join(credentialsDir, "credentials.json");

try {
  const existing = JSON.parse(await readFile(credentialsPath, "utf8"));
  console.log(
    JSON.stringify({
      reused: true,
      agentId: existing.agentId,
      name: existing.name,
      credentialsPath,
    }),
  );
  process.exit(0);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const name = "ten-dollar-wallet-worker";
const description =
  "Small, tested Python automation, CSV/JSON transformation, public API triage, and documentation work. Public samples: https://github.com/mundodr/ten-dollar-wallet-test";

async function post(route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Agent Hansa request failed for ${route} (${response.status}): ${JSON.stringify(result)}`,
    );
  }
  return result;
}

function numberFromText(value) {
  if (/^\d+$/.test(value)) return Number(value);
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
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
  };
  return words[value.toLowerCase()];
}

function solveChallenge(question) {
  const first = question.match(/\bhas\s+(\d+|[a-z]+)\b/i);
  const fewer = question.match(/\bhas\s+(\d+|[a-z]+)\s+fewer\b/i);
  const more = question.match(/\bhas\s+(\d+|[a-z]+)\s+more\b/i);
  const firstValue = first ? numberFromText(first[1]) : undefined;
  if (Number.isFinite(firstValue) && fewer) {
    return firstValue - numberFromText(fewer[1]);
  }
  if (Number.isFinite(firstValue) && more) {
    return firstValue + numberFromText(more[1]);
  }
  throw new Error(`Unsupported Agent Hansa registration challenge: ${question}`);
}

let created;
if (
  process.env.AGENTHANSA_CHALLENGE_ID &&
  process.env.AGENTHANSA_CHALLENGE_ANSWER
) {
  created = await post("/api/agents/register/verify", {
    challenge_id: process.env.AGENTHANSA_CHALLENGE_ID,
    challenge_answer: Number(process.env.AGENTHANSA_CHALLENGE_ANSWER),
  });
} else {
  created = await post("/api/agents/register", { name, description });
}
if (created.status === "challenge_required") {
  created = await post("/api/agents/register/verify", {
    challenge_id: created.challenge_id,
    challenge_answer: solveChallenge(created.question),
  });
}

const agentId = created.id ?? created.agent_id;
const apiKey = created.api_key ?? created.apiKey;
if (!agentId || !apiKey) {
  throw new Error(`Agent Hansa returned incomplete credentials: ${JSON.stringify(created)}`);
}

await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
await writeFile(
  credentialsPath,
  `${JSON.stringify(
    {
      agentId,
      apiKey,
      name: created.name ?? name,
      registeredAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);

console.log(
  JSON.stringify({
    reused: false,
    agentId,
    name: created.name ?? name,
    credentialsPath,
  }),
);
