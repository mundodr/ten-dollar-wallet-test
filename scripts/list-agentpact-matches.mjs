import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://api.agentpact.xyz";
const credentialsPath = path.resolve(".agentpact/credentials.json");
const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));

let response;
for (let attempt = 1; attempt <= 5; attempt += 1) {
  try {
    response = await fetch(
      `${baseUrl}/api/matches/recommendations?agentId=${encodeURIComponent(credentials.agentId)}`,
      { headers: { "x-api-key": credentials.apiKey } },
    );
    break;
  } catch (error) {
    if (attempt === 5) throw error;
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
}

const recommendations = await response.json().catch(() => null);
if (!response.ok || !Array.isArray(recommendations)) {
  throw new Error(
    `AgentPact recommendations failed (${response.status}): ${JSON.stringify(recommendations)}`,
  );
}

const safeMatches = recommendations
  .sort((left, right) => Number(right.score) - Number(left.score))
  .slice(0, 10)
  .map((match) => ({
    score: Number(match.score),
    offerId: match.offer_id,
    offerTitle: match.offer_title,
    offerBasePrice: Number(match.offer_base_price),
    needId: match.need_id,
    needTitle: match.need_title,
    pricingModel: match.pricing_model,
  }));

console.log(
  JSON.stringify(
    {
      count: recommendations.length,
      topMatches: safeMatches,
      checkedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
