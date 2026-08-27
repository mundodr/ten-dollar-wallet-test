const hubUrl = "https://api.ideafactorylab.org";
const submissionId = "sub_1787832950016";
const serviceName = "Deterministic API Brief Acceptance Checklist";
const serviceUrl =
  "https://payanagent.com/x402/kh7ezjzt4etk8x1s908z7wngqn8d89hx";

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
      lastError = new Error(`Cinderwright returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError ?? new Error("Cinderwright returned no response");
}

const query = new URL("/discover", hubUrl);
query.searchParams.set("q", serviceName);
const discovery = await fetchJson(query);
const results = Array.isArray(discovery?.results) ? discovery.results : [];
const indexedResult = results.find((result) => {
  const candidateUrl = result?.url ?? result?.endpoint ?? result?.service_url;
  return candidateUrl === serviceUrl || result?.name === serviceName;
});

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      submissionId,
      serviceName,
      serviceUrl,
      status: indexedResult ? "indexed" : "queued",
      indexed: Boolean(indexedResult),
      hubReportedTotal: discovery?.total ?? null,
      result: indexedResult ?? null,
    },
    null,
    2,
  ),
);
