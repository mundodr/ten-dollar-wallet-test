const hubUrl = "https://api.ideafactorylab.org";
const submissionId = "sub_1787832950016";
const serviceName = "Deterministic API Brief Acceptance Checklist";
const serviceUrl =
  "https://payanagent.com/x402/kh7ezjzt4etk8x1s908z7wngqn8d89hx";
const codeReviewSubmissionId = "sub_1788204559284";
const codeReviewServiceName =
  "Deterministic Python Security Review (One File)";
const codeReviewServiceUrl =
  "https://payanagent.com/x402/kh7csa6y1atvzs35bneg89xx0d8dhm2d";

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

async function discoverService(name, url) {
  const query = new URL("/discover", hubUrl);
  query.searchParams.set("q", name);
  const discovery = await fetchJson(query);
  const results = Array.isArray(discovery?.results) ? discovery.results : [];
  const indexedResult = results.find((result) => {
    const candidateUrl = result?.url ?? result?.endpoint ?? result?.service_url;
    return candidateUrl === url || result?.name === name;
  });
  return {
    indexedResult: indexedResult ?? null,
    total: discovery?.total ?? null,
  };
}

const [acceptance, codeReview] = await Promise.all([
  discoverService(serviceName, serviceUrl),
  discoverService(codeReviewServiceName, codeReviewServiceUrl),
]);

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      submissionId,
      serviceName,
      serviceUrl,
      status: acceptance.indexedResult ? "indexed" : "queued",
      indexed: Boolean(acceptance.indexedResult),
      hubReportedTotal: acceptance.total,
      result: acceptance.indexedResult,
      codeReview: {
        submissionId: codeReviewSubmissionId,
        serviceName: codeReviewServiceName,
        serviceUrl: codeReviewServiceUrl,
        status: codeReview.indexedResult ? "indexed" : "queued",
        indexed: Boolean(codeReview.indexedResult),
        hubReportedTotal: codeReview.total,
        result: codeReview.indexedResult,
      },
      countingPolicy:
        "Submissions and index rows are discovery evidence only. Never self-buy. Count only an independently verified Base-mainnet target receipt.",
    },
    null,
    2,
  ),
);
