import { execFileSync } from "node:child_process";

const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);
const queries = [
  `is:issue is:open USDC bounty in:title,body updated:>=${since}`,
  `is:issue is:open SOL bounty in:title,body updated:>=${since}`,
  `is:issue is:open USDT bounty in:title,body updated:>=${since}`,
  `is:issue is:open "Base USDC" reward in:title,body updated:>=${since}`,
  `is:issue is:open "paid in USDC" in:title,body updated:>=${since}`,
  `is:issue is:open "paid in SOL" in:title,body updated:>=${since}`,
  `is:issue is:open "BNB" reward in:title,body updated:>=${since}`,
  `is:issue is:open crypto reward in:title,body updated:>=${since}`,
];

function search(query) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const output = execFileSync(
        "gh",
        [
          "api",
          "-X",
          "GET",
          "search/issues",
          "-f",
          `q=${query}`,
          "-f",
          "per_page=50",
        ],
        { encoding: "utf8", timeout: 30_000 },
      );
      return JSON.parse(output).items ?? [];
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const excludedRepos = new Set([
  "ASHWIN776/payobvio-test",
  "ClankerNation/OpenAgents",
  "NSPG13/agent-bounties",
  "dev-kp-eloper/BountyScout",
  "freedom-winds/BountyScout",
  "gigs-sh/gigs-sh",
  "priyanshudotsol/bounty-demo",
  "relayhop/ClaudeEarnSelf-runtime",
  "tinyhumansai/tiny.place",
  "vansh-09/BountyScout",
  "zhangjiayang6835-cyber/bounty-plaza",
  "kwizzlesurp10-ctrl/x402-mcp",
]);
const excludedPattern =
  /test bounty|testnet|sepolia|funding[- ]pending|send (?:usdc|sol)|\bpayto\b|stake|deposit|private key|seed phrase|full platform initialization|paste the entire block|watch our repos?|open an issue or comment|referral|self[- ]fund|entry fee|youtube|screen recording|film a real demo|bounty alert|owockibot|grantfox|maybe rewarded|twitter\/x thread|write (?:a )?twitter|\bgpt[- ]?\d+(?:\.\d+)?[- ]sol\b/i;
const paymentPattern = /\b(?:usdc|usdt|sol|bnb|eth|base|crypto)\b/i;
const workPattern = /\b(?:bounty|reward|payout|paid)\b/i;
const explicitAmountPattern =
  /(?:\$\s*\d+(?:\.\d+)?\s*(?:usdc|usdt|sol|bnb|eth)|\b\d+(?:\.\d+)?\s*(?:usdc|usdt|sol|bnb|eth)\b)/i;

const seen = new Set();
const opportunities = [];
for (const query of queries) {
  for (const issue of search(query)) {
    if (seen.has(issue.html_url)) continue;
    seen.add(issue.html_url);
    const repository = issue.repository_url.split("/repos/")[1];
    const text = `${issue.title}\n${issue.body ?? ""}`;
    if (excludedRepos.has(repository)) continue;
    if (excludedPattern.test(text)) continue;
    if (!paymentPattern.test(text) || !workPattern.test(text)) continue;
    if (!explicitAmountPattern.test(text)) continue;
    opportunities.push({
      repository,
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      labels: (issue.labels ?? []).map((label) => label.name),
      excerpt: (issue.body ?? "").replace(/\s+/g, " ").slice(0, 300),
    });
  }
}

opportunities.sort(
  (left, right) => new Date(right.updatedAt) - new Date(left.updatedAt),
);

console.log(
  JSON.stringify(
    {
      count: opportunities.length,
      checkedAt: new Date().toISOString(),
      opportunities: opportunities.slice(0, 25),
    },
    null,
    2,
  ),
);
