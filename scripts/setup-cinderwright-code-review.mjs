const hubUrl = "https://api.ideafactorylab.org";
const serviceName = "Deterministic Python Security Review (One File)";
const serviceUrl =
  "https://payanagent.com/x402/kh7csa6y1atvzs35bneg89xx0d8dhm2d";
const targetPayTo = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const expectedAmount = "5000000";
// The accepted queue row is pinned so reruns never create a duplicate.
const knownSubmissionId = "sub_1788204559284";

async function requestJson(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => null);
      if (response.status !== 429 && response.status < 500) {
        return { response, body };
      }
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

function decodeChallenge(response, body) {
  const encoded =
    response.headers.get("payment-required") ??
    response.headers.get("x-payment-required");
  if (encoded) {
    try {
      return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    } catch {
      // Fall through to the JSON body.
    }
  }
  return body;
}

const live = await requestJson(serviceUrl, {
  method: "POST",
  body: JSON.stringify({ code: "import pickle\npickle.loads(payload)" }),
});
const challenge = decodeChallenge(live.response, live.body);
const payment = challenge?.accepts?.[0];
const exactLiveTerms =
  live.response.status === 402 &&
  challenge?.x402Version === 2 &&
  challenge?.resource?.url === serviceUrl &&
  payment?.scheme === "exact" &&
  payment?.network === "eip155:8453" &&
  payment?.amount === expectedAmount &&
  String(payment?.payTo).toLowerCase() === targetPayTo &&
  String(payment?.asset).toLowerCase() === baseUsdc.toLowerCase();
if (!exactLiveTerms) {
  throw new Error("Code-review endpoint no longer has exact direct-target terms");
}

const query = new URL("/discover", hubUrl);
query.searchParams.set("q", serviceName);
const discovery = await requestJson(query);
if (!discovery.response.ok) {
  throw new Error(`Cinderwright discovery failed (${discovery.response.status})`);
}
const results = Array.isArray(discovery.body?.results)
  ? discovery.body.results
  : [];
const matching = results.find((row) => {
  const candidateUrl = row?.url ?? row?.endpoint ?? row?.service_url;
  return candidateUrl === serviceUrl;
});

if (matching || knownSubmissionId) {
  console.log(
    JSON.stringify(
      {
        submitted: false,
        reused: true,
        submissionId: knownSubmissionId,
        indexed: Boolean(matching),
        result: matching ?? null,
        serviceName,
        serviceUrl,
        exactLiveTerms,
        paymentAttempted: false,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const submission = await requestJson(`${hubUrl}/submit`, {
  method: "POST",
  body: JSON.stringify({
    url: serviceUrl,
    name: serviceName,
    description:
      "Review one bounded Python source file without executing it and return deterministic line-specific JSON security findings. Payment is 5 USDC on Base directly to the listed recipient.",
  }),
});
if (!submission.response.ok) {
  throw new Error(
    `Cinderwright submission failed (${submission.response.status}): ${submission.body?.error ?? submission.body?.message ?? "unknown"}`,
  );
}
const submissionId =
  submission.body?.submission_id ?? submission.body?.submissionId ?? submission.body?.id;
if (!submissionId) {
  throw new Error("Cinderwright accepted the submission without returning an ID");
}

console.log(
  JSON.stringify(
    {
      submitted: true,
      reused: false,
      submissionId,
      status: submission.body?.status ?? "queued",
      serviceName,
      serviceUrl,
      exactLiveTerms,
      directTarget: targetPayTo,
      paymentAttempted: false,
      nextAction:
        "Pin this submission ID in the setup and monitor scripts before any rerun.",
      countingPolicy:
        "Submission and indexing are discovery evidence only. Never self-buy; count only an independently verified Base-mainnet target receipt.",
    },
    null,
    2,
  ),
);
