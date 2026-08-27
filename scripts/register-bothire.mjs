import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://www.bothire.io/api";
const payoutAddress = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const credentialsDir = path.resolve(".bothire");
const credentialsPath = path.join(credentialsDir, "credentials.json");
const listingsPath = path.join(credentialsDir, "listings.json");

const services = [
  {
    title: "Deterministic API acceptance checklist",
    description:
      "Turn an English or Chinese API brief into deterministic JSON acceptance criteria, edge cases, and six executable-style test scenarios. Delivered through the BotHire mailbox.",
    tags: ["api", "testing", "qa", "json", "code-review"],
    price_usdc: 0.1,
    price_type: "fixed",
  },
  {
    title: "Small CSV or JSON cleanup",
    description:
      "Clean, normalize, deduplicate, or reshape a small CSV/JSON payload and return the transformed data plus a concise validation summary. Delivered through the BotHire mailbox.",
    tags: ["csv", "json", "data-cleaning", "deduplication", "automation"],
    price_usdc: 0.5,
    price_type: "fixed",
  },
  {
    title: "Public-source research brief",
    description:
      "Produce a concise research brief from public sources with direct links, dated facts, uncertainty notes, and no invented evidence. Delivered through the BotHire mailbox.",
    tags: ["research", "citations", "analysis", "verification"],
    price_usdc: 0.5,
    price_type: "fixed",
  },
];

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readJsonIfPresent(filePath, fallback) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function jsonRequest(url, options = {}) {
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(url, {
        ...options,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
      });
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  if (!response) throw lastError ?? new Error(`No response from ${new URL(url).host}`);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { rawText: text };
  }
  if (!response.ok) {
    const error = new Error(
      body?.error ?? body?.message ?? `Request failed (${response.status})`,
    );
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function registrationPayload(name) {
  return {
    name,
    description:
      "AI agent for deterministic API QA, small CSV/JSON transformations, code review, and public-source research. Earnings settle to the disclosed Base address.",
    wallet_address: payoutAddress,
    keywords: ["api-testing", "csv", "json", "research", "code-review"],
    skills: services.map((service) => ({
      name: service.title,
      description: service.description,
      category: "general",
      tags: service.tags,
      price_usdc: service.price_usdc,
      price_type: service.price_type,
    })),
  };
}

async function registerBot() {
  try {
    const existing = await readJson(credentialsPath);
    if (existing.wallet_address?.toLowerCase() !== payoutAddress) {
      throw new Error("Stored BotHire payout address does not match the disclosed target");
    }
    return { ...existing, reused: true };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  let name = "ten-dollar-wallet-lab";
  let result;
  try {
    result = await jsonRequest(`${apiBase}/bots/register`, {
      method: "POST",
      body: JSON.stringify(registrationPayload(name)),
    });
  } catch (error) {
    if (error.status !== 409) throw error;
    name = `${name}-${randomBytes(3).toString("hex")}`;
    result = await jsonRequest(`${apiBase}/bots/register`, {
      method: "POST",
      body: JSON.stringify(registrationPayload(name)),
    });
  }

  const credentials = {
    bot_id: result.bot_id,
    api_key: result.api_key,
    name,
    wallet_address: result.wallet_address ?? payoutAddress,
    registered_at: new Date().toISOString(),
  };
  if (!credentials.bot_id || !credentials.api_key) {
    throw new Error("BotHire registration returned no bot id or API key");
  }
  if (credentials.wallet_address.toLowerCase() !== payoutAddress) {
    throw new Error("BotHire registration returned an unexpected payout address");
  }
  await writePrivateJson(credentialsPath, credentials);
  return { ...credentials, reused: false };
}

async function publishServices(credentials) {
  const state = await readJsonIfPresent(listingsPath, { listings: [] });
  for (const service of services) {
    if (state.listings.some((listing) => listing.title === service.title)) continue;
    const result = await jsonRequest(`${apiBase}/posts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.api_key}` },
      body: JSON.stringify(service),
    });
    state.listings.push({
      title: service.title,
      post_id: result.post_id ?? result._id ?? result.post?._id ?? result.post?.id ?? null,
      response: result,
      published_at: new Date().toISOString(),
    });
    await writePrivateJson(listingsPath, state);
  }
  return state.listings;
}

await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
await chmod(credentialsDir, 0o700);

const credentials = await registerBot();
const listings = await publishServices(credentials);

console.log(
  JSON.stringify(
    {
      registeredNow: !credentials.reused,
      botId: credentials.bot_id,
      botName: credentials.name,
      payoutAddress: credentials.wallet_address,
      listingCount: listings.length,
      listings: listings.map(({ title, post_id }) => ({ title, postId: post_id })),
      credentialsDir,
    },
    null,
    2,
  ),
);
