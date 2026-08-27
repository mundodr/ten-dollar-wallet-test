const postingsUrl = "https://api.the402.ai/v1/postings?limit=100";

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(25_000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`the402 returned HTTP ${response.status}`);
      }
      return body;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("the402 returned no response");
}

const response = await fetchJson(postingsUrl);
const postings = Array.isArray(response?.postings) ? response.postings : [];
const openPostings = postings.filter(
  (posting) =>
    !posting.status || ["open", "accepting_bids"].includes(posting.status),
);

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      registered: false,
      registrationPendingEligibilityConfirmation: true,
      publicPostingCount: postings.length,
      openPostingCount: openPostings.length,
      openPostings: openPostings.map((posting) => ({
        id: posting.id ?? posting.posting_id,
        title: posting.title,
        description: posting.description ?? posting.brief ?? null,
        category: posting.category ?? null,
        budgetUsd:
          posting.budget_usd ??
          posting.max_budget_usd ??
          posting.budget?.max ??
          null,
        funded: posting.funded ?? (posting.payment_status === "funded"),
        createdAt: posting.created_at ?? null,
      })),
      payoutTarget: {
        network: "Base",
        asset: "USDC",
        address: "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18",
        configured: false,
      },
      nextAction:
        openPostings.length > 0
          ? "Review scope and funding, then confirm account eligibility before provider registration or bidding."
          : "Keep monitoring the public request feed.",
    },
    null,
    2,
  ),
);
