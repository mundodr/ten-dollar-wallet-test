const apiUrl = "https://api.x402.jobs";
const resourceId = "156cb10b-cf6e-4bd2-ab78-c06c6acc5517";
const resourceUrl =
  "https://payanagent.com/x402/kh7ezjzt4etk8x1s908z7wngqn8d89hx";
const publicUrl =
  "https://www.x402.jobs/resources/payanagent-com/deterministic-api-brief-acceptance-checklist-base";

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) return body;
      lastError = new Error(`x402.jobs returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError ?? new Error("x402.jobs returned no response");
}

const query = new URL("/api/v1/resources", apiUrl);
query.searchParams.set("search", "deterministic api brief acceptance checklist");
query.searchParams.set("limit", "20");
const catalog = await fetchJson(query);
const resource = (catalog?.resources ?? []).find(
  (candidate) => candidate.id === resourceId,
);
const exactResource =
  resource?.resource_url === resourceUrl &&
  resource?.network === "base" &&
  resource?.max_amount_required === "10000";

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      resourceId,
      publicUrl,
      listed: Boolean(resource),
      exactResource,
      network: resource?.network ?? null,
      amountBaseUnits: resource?.max_amount_required ?? null,
      calls: resource?.call_count ?? null,
      totalEarnedUsdc: resource?.total_earned_usdc ?? null,
      successRate: resource?.success_rate ?? null,
      lastCalledAt: resource?.last_called_at ?? null,
    },
    null,
    2,
  ),
);

if (!exactResource) {
  throw new Error("x402.jobs listing no longer matches the intended Base resource");
}
