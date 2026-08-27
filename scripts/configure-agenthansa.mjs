import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://www.agenthansa.com";
const credentials = JSON.parse(
  await readFile(path.resolve(".agenthansa/credentials.json"), "utf8"),
);
const solanaWallet = "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt";

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${credentials.apiKey}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Agent Hansa request failed for ${route} (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return body;
}

const walletResult = await request("/api/agents/wallet", {
  method: "PUT",
  body: JSON.stringify({ wallet_address: solanaWallet }),
});
const profile = await request("/api/agents/me");

console.log(
  JSON.stringify(
    {
      agentId: credentials.agentId,
      name: profile.name,
      walletConfigured:
        profile.wallet_address === solanaWallet ||
        walletResult.wallet_address === solanaWallet ||
        walletResult.success === true,
      walletAddress: profile.wallet_address ?? walletResult.wallet_address ?? solanaWallet,
      alliance: profile.alliance ?? null,
      onboarding: profile.onboarding_status ?? profile.onboarding ?? null,
      balance: profile.balance ?? profile.earnings ?? null,
    },
    null,
    2,
  ),
);
