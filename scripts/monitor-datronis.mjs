import fs from "node:fs/promises";
import path from "node:path";

const stateDirectory = path.resolve(".datronis");
const statusPath = path.join(stateDirectory, "status.json");
const boardUrl = "https://datronis.com/freelance/bounties/";
const termsUrl = "https://datronis.com/terms-of-service/";

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: { "user-agent": "ten-dollar-wallet-worker/1.0" },
      });
      const text = await response.text();
      return { ok: response.ok, status: response.status, text };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return { ok: false, status: 0, text: "", error: lastError?.message };
}

const [board, terms] = await Promise.all([fetchText(boardUrl), fetchText(termsUrl)]);
const visibleText = board.text
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&#39;/g, "'")
  .replace(/\s+/g, " ")
  .trim();
const categories = [
  "All",
  "Development",
  "Content & Writing",
  "Design & Media",
  "Translation & Localization",
  "QA & Security",
  "Marketing & Growth",
];
const counts = {};
for (const category of categories) {
  const match = visibleText.match(new RegExp(`${category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(\\d+)`));
  counts[category] = match ? Number(match[1]) : null;
}
const detailLinks = [...board.text.matchAll(/href=["']([^"']*\/freelance\/bounties\/[^"'#?]+)["']/gi)]
  .map((match) => new URL(match[1], boardUrl).href)
  .filter((url) => !url.endsWith("/new/"));
const uniqueDetailLinks = [...new Set(detailLinks)];
const minimumAgeRequired = /at least\s+16\s+years\s+old/i.test(terms.text);

const snapshot = {
  checkedAt: new Date().toISOString(),
  board: {
    url: boardUrl,
    ok: board.ok,
    status: board.status,
    counts,
    openCount: counts.All,
    detailLinks: uniqueDetailLinks,
  },
  terms: {
    url: termsUrl,
    ok: terms.ok,
    status: terms.status,
    minimumAgeRequired,
    accountRegistrationAllowed: false,
    reason:
      "Datronis requires an account creator to be at least 16. No factual age confirmation is available, so the project must not attest to it.",
  },
  nextAction:
    Number(counts.All) > 0
      ? "Inspect public bounty details, funding evidence, and whether a no-account delivery path exists. Do not register or assert age."
      : "Keep the public board under read-only monitoring.",
  countingPolicy:
    "A public bounty or profile is not income. Only an independently verified matching mainnet receipt at a disclosed target counts.",
};

await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
await fs.chmod(stateDirectory, 0o700);
await fs.writeFile(statusPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
  mode: 0o600,
});
await fs.chmod(statusPath, 0o600);
console.log(JSON.stringify(snapshot, null, 2));
