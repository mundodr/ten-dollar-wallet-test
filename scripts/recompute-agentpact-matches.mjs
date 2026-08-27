import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://api.agentpact.xyz";
const credentialsPath = path.resolve(".agentpact/credentials.json");
const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastError;
}

const recomputeResponse = await fetchWithRetry(`${baseUrl}/api/matches/recompute`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": credentials.apiKey,
  },
  body: JSON.stringify({ agentId: credentials.agentId }),
});
const recomputeResult = await recomputeResponse.json().catch(() => null);
if (!recomputeResponse.ok) {
  throw new Error(
    `AgentPact match recompute failed (${recomputeResponse.status}): ${JSON.stringify(recomputeResult)}`,
  );
}

const recommendationsResponse = await fetchWithRetry(
  `${baseUrl}/api/matches/recommendations?agentId=${encodeURIComponent(credentials.agentId)}`,
  { headers: { "x-api-key": credentials.apiKey } },
);
const recommendations = await recommendationsResponse.json().catch(() => null);
if (!recommendationsResponse.ok || !Array.isArray(recommendations)) {
  throw new Error(
    `AgentPact recommendations failed (${recommendationsResponse.status}): ${JSON.stringify(recommendations)}`,
  );
}

const ownRecommendations = recommendations
  .sort((left, right) => Number(right.score) - Number(left.score))
  .slice(0, 10)
  .map((match) => ({
    id: match.id,
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
      recompute: recomputeResult,
      count: recommendations.length,
      topRecommendations: ownRecommendations,
      checkedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
