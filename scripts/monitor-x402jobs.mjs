import { readFile } from "node:fs/promises";
import path from "node:path";

const apiUrl = "https://api.x402.jobs";
const targetBaseWallet =
  "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const x402JobsBaseEscrow = "0xAEB58049d3C266D55595a596Fae249C10764a031";
const jobStatePath = path.resolve(".x402jobs/code-review-job-state.json");

const expectedResources = [
  {
    resourceId: "156cb10b-cf6e-4bd2-ab78-c06c6acc5517",
    name: "Deterministic API Brief Acceptance Checklist",
    resourceUrl:
      "https://payanagent.com/x402/kh7ezjzt4etk8x1s908z7wngqn8d89hx",
    publicUrl:
      "https://www.x402.jobs/resources/payanagent-com/deterministic-api-brief-acceptance-checklist-base",
    catalogSearch: "deterministic api brief acceptance checklist",
    amountBaseUnits: "10000",
    probeBody: {
      input:
        "POST /v1/orders requires bearer auth, returns HTTP 201, and retries must be idempotent.",
    },
  },
  {
    resourceId: "d5bda12c-79c9-4592-9429-8e34941414a2",
    name: "Deterministic Python Security Review (One File)",
    resourceUrl:
      "https://payanagent.com/x402/kh7csa6y1atvzs35bneg89xx0d8dhm2d",
    publicUrl:
      "https://www.x402.jobs/resources/payanagent-com/deterministic-python-security-review-one-file-base",
    catalogSearch: "python security review",
    amountBaseUnits: "5000000",
    probeBody: { code: "print('hello')" },
  },
];

async function fetchResponse(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => null);
      if (response.status !== 429 && response.status < 500) {
        return { response, body };
      }
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

function decodeChallenge(result) {
  const encoded =
    result.response.headers.get("payment-required") ??
    result.response.headers.get("x-payment-required");
  if (encoded) {
    try {
      return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    } catch {
      // Fall back to the response body.
    }
  }
  return result.body;
}

function exactChallenge(result, expected) {
  const challenge = decodeChallenge(result);
  const payment = challenge?.accepts?.[0];
  return (
    result.response.status === 402 &&
    challenge?.x402Version === 2 &&
    challenge?.resource?.url === expected.resourceUrl &&
    payment?.scheme === "exact" &&
    payment?.network === "eip155:8453" &&
    payment?.amount === expected.amountBaseUnits &&
    String(payment?.payTo).toLowerCase() === targetBaseWallet &&
    String(payment?.asset).toLowerCase() === baseUsdc.toLowerCase()
  );
}

async function inspectResource(expected) {
  const checkUrl = new URL("/api/v1/resources/check", apiUrl);
  checkUrl.searchParams.set("url", expected.resourceUrl);
  const catalogUrl = new URL("/api/v1/resources", apiUrl);
  catalogUrl.searchParams.set("search", expected.catalogSearch);
  catalogUrl.searchParams.set("limit", "100");
  const [checkResult, catalogResult, challengeResult] = await Promise.all([
    fetchResponse(checkUrl, { headers: { Accept: "application/json" } }),
    fetchResponse(catalogUrl, { headers: { Accept: "application/json" } }),
    fetchResponse(expected.resourceUrl, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(expected.probeBody),
    }),
  ]);

  const checkResource = checkResult.body?.resource ?? null;
  const resource = (catalogResult.body?.resources ?? []).find(
    (candidate) => candidate.id === expected.resourceId,
  );
  const exactResource =
    checkResult.response.ok &&
    checkResult.body?.found === true &&
    checkResource?.id === expected.resourceId &&
    checkResource?.resource_url === expected.resourceUrl &&
    catalogResult.response.ok &&
    resource?.id === expected.resourceId &&
    resource?.resource_url === expected.resourceUrl &&
    resource?.network === "base" &&
    resource?.max_amount_required === expected.amountBaseUnits;
  const challengeExact = exactChallenge(challengeResult, expected);

  return {
    resourceId: expected.resourceId,
    name: expected.name,
    publicUrl: expected.publicUrl,
    listed: Boolean(checkResource && resource),
    exactResource,
    challengeExact,
    network: resource?.network ?? null,
    amountBaseUnits: resource?.max_amount_required ?? null,
    priceUsdc: Number(expected.amountBaseUnits) / 1_000_000,
    calls: resource?.call_count ?? resource?.calls ?? null,
    totalEarnedUsdc: resource?.total_earned_usdc ?? null,
    successRate: resource?.success_rate ?? null,
    lastCalledAt: resource?.last_called_at ?? null,
  };
}

async function inspectPublishedJob() {
  const state = await readFile(jobStatePath, "utf8")
    .then(JSON.parse)
    .catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
  if (!state) return null;

  const publicUrl = new URL("/jobs/public", apiUrl);
  publicUrl.searchParams.set("search", state.jobName);
  publicUrl.searchParams.set("limit", "100");
  const publicResult = await fetchResponse(publicUrl, {
    headers: { Accept: "application/json" },
  });
  const job = (publicResult.body?.jobs ?? []).find(
    (candidate) => candidate.id === state.jobId,
  );
  if (!job?.webhook_url) {
    return {
      jobId: state.jobId,
      listed: false,
      exact: false,
    };
  }

  const probe = await fetchResponse(job.webhook_url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ code: "print('hello')" }),
  });
  const challenge = decodeChallenge(probe);
  const payment = challenge?.accepts?.[0];
  const amount =
    challenge?.x402Version === 1
      ? payment?.maxAmountRequired
      : payment?.amount;
  const resource =
    challenge?.x402Version === 1
      ? payment?.resource
      : challenge?.resource?.url;
  const exactChallenge =
    probe.response.status === 402 &&
    [1, 2].includes(challenge?.x402Version) &&
    payment?.scheme === "exact" &&
    ["base", "eip155:8453"].includes(payment?.network) &&
    amount === state.buyerAmountBaseUnits &&
    resource === job.webhook_url &&
    String(payment?.asset).toLowerCase() === baseUsdc.toLowerCase() &&
    String(payment?.payTo).toLowerCase() === x402JobsBaseEscrow.toLowerCase();
  const exactListing =
    publicResult.response.ok &&
    job.network === "base" &&
    Number(job.price) === Number(state.buyerAmountBaseUnits) / 1_000_000 &&
    Number(job.baseCost) === Number(state.buyerAmountBaseUnits) / 1_000_000 &&
    Number(job.creatorMarkup) === 0;

  return {
    jobId: state.jobId,
    name: state.jobName,
    publicPage: state.publicPage,
    webhookUrl: job.webhook_url,
    listed: true,
    exact: exactListing && exactChallenge,
    exactListing,
    exactChallenge,
    buyerPriceUsdc: Number(state.buyerAmountBaseUnits) / 1_000_000,
    downstreamPriceUsdc: Number(state.resourceAmountBaseUnits) / 1_000_000,
    creatorMarkupUsdc: Number(job.creatorMarkup),
    runCount: Number(job.run_count ?? 0),
    successfulRuns30d: Number(job.success_count_30d ?? 0),
    failedRuns30d: Number(job.failure_count_30d ?? 0),
    totalEarningsUsdc: Number(job.total_earnings_usdc ?? job.earnings ?? 0),
  };
}

const [resources, publishedJob] = await Promise.all([
  Promise.all(expectedResources.map(inspectResource)),
  inspectPublishedJob(),
]);
const exactResourceCount = resources.filter(
  (resource) => resource.exactResource && resource.challengeExact,
).length;
const calls = resources.reduce(
  (total, resource) => total + Number(resource.calls ?? 0),
  0,
);
const totalEarnedUsdc = resources.reduce(
  (total, resource) => total + Number(resource.totalEarnedUsdc ?? 0),
  0,
);

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      targetBaseWallet,
      resourceCount: resources.length,
      exactResourceCount,
      calls,
      totalEarnedUsdc,
      resources,
      publishedJob,
      countingPolicy:
        "Catalog rows, job runs, and earnings counters are discovery signals only. Never self-buy. Count only an independently verified Base-mainnet transfer to the disclosed target wallet.",
    },
    null,
    2,
  ),
);

if (exactResourceCount !== expectedResources.length) {
  throw new Error("One or more x402.jobs resources drifted from their exact Base payment terms");
}
if (publishedJob && !publishedJob.exact) {
  throw new Error("The published x402.jobs workflow drifted from its exact buyer terms");
}
