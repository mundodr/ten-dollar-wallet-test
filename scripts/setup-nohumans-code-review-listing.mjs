import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiUrl = "https://api.nohumans.directory";
const privateDir = path.resolve(".nohumans");
const statePath = path.join(privateDir, "code-review-listing-state.json");
const endpointUrl =
  "https://payanagent.com/x402/kh7csa6y1atvzs35bneg89xx0d8dhm2d";
const targetPayTo = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const amountAtomic = "5000000";
const listingName = "Deterministic Python Security Review (One File)";

async function request(url, options = {}) {
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
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError ?? new Error(`No response from ${new URL(url).host}`);
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

function exactLiveTerms(result) {
  const challenge = decodeChallenge(result);
  const payment = challenge?.accepts?.[0];
  return (
    result.response.status === 402 &&
    challenge?.x402Version === 2 &&
    challenge?.resource?.url === endpointUrl &&
    payment?.scheme === "exact" &&
    payment?.network === "eip155:8453" &&
    payment?.amount === amountAtomic &&
    String(payment?.payTo).toLowerCase() === targetPayTo &&
    String(payment?.asset).toLowerCase() === baseUsdc.toLowerCase()
  );
}

function exactListing(listing) {
  return (
    listing?.endpoint_url === endpointUrl &&
    listing?.name === listingName &&
    listing?.category === "infra.security" &&
    Number(listing?.price_amount) === 5 &&
    listing?.price_currency === "USDC" &&
    listing?.chains?.includes("base")
  );
}

await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);

const liveProbe = await request(endpointUrl, {
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json" },
  body: JSON.stringify({ code: "print('hello')" }),
});
if (!exactLiveTerms(liveProbe)) {
  throw new Error("Code-review endpoint no longer has exact direct-target terms");
}

let saved = await readFile(statePath, "utf8")
  .then(JSON.parse)
  .catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
let listing = null;
let created = false;

if (saved?.id) {
  const current = await request(
    `${apiUrl}/v1/listings/${encodeURIComponent(saved.id)}`,
  );
  if (current.response.ok && exactListing(current.body)) listing = current.body;
  else if (current.response.ok) {
    throw new Error("Saved nohumans code-review listing drifted");
  }
}

if (!listing) {
  const discoverUrl = new URL("/v1/discover", apiUrl);
  discoverUrl.searchParams.set(
    "q",
    "deterministic Python security review static code audit",
  );
  discoverUrl.searchParams.set("limit", "50");
  const discovered = await request(discoverUrl, {
    headers: { Accept: "application/json" },
  });
  const exactMatches = (discovered.body?.results ?? []).filter(
    (candidate) => candidate.endpoint_url === endpointUrl,
  );
  if (exactMatches.length > 1) {
    throw new Error("Multiple nohumans listings already use the code-review endpoint");
  }
  if (exactMatches.length === 1) {
    if (!exactListing(exactMatches[0])) {
      throw new Error("Existing nohumans endpoint listing has mismatched metadata");
    }
    listing = exactMatches[0];
  }
}

if (!listing) {
  const submission = await request(`${apiUrl}/v1/listings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: listingName,
      description:
        "Review one bounded Python source file without executing it. Returns deterministic, line-specific JSON findings for shell execution, embedded credentials, unsafe deserialization, and missing network timeouts.",
      endpoint_url: endpointUrl,
      category: "infra.security",
      kind: "api",
      price_amount: 5,
      price_currency: "USDC",
      chains: ["base"],
      request_schema: {
        type: "object",
        required: ["code"],
        additionalProperties: false,
        properties: {
          code: {
            type: "string",
            minLength: 1,
            maxLength: 65536,
            description: "One Python source file as plain text.",
          },
        },
      },
      response_schema: {
        type: "object",
        required: ["language", "methodology", "finding_count", "findings"],
        properties: {
          language: { const: "python" },
          methodology: { type: "string" },
          finding_count: { type: "integer", minimum: 0 },
          findings: { type: "array", items: { type: "object" } },
        },
      },
    }),
  });
  if (submission.response.status === 409) {
    throw new Error(
      "nohumans reports the endpoint is already listed but discovery did not return it",
    );
  }
  if (!submission.response.ok || !submission.body?.id) {
    throw new Error(
      `nohumans submission failed (${submission.response.status}): ${submission.body?.error ?? submission.body?.message ?? "unknown"}`,
    );
  }
  listing = submission.body;
  saved = {
    ...submission.body,
    endpointUrl,
    submittedAt: new Date().toISOString(),
  };
  created = true;
}

await writeFile(statePath, `${JSON.stringify(saved ?? listing, null, 2)}\n`, {
  mode: 0o600,
});
await chmod(statePath, 0o600);

const published = await request(
  `${apiUrl}/v1/listings/${encodeURIComponent(listing.id)}`,
);
if (!published.response.ok || !exactListing(published.body)) {
  throw new Error("nohumans did not publish the exact code-review listing");
}

console.log(
  JSON.stringify(
    {
      created,
      listingId: listing.id,
      publicUrl: `${apiUrl}/v1/listings/${listing.id}`,
      status: published.body.status,
      exactListing: true,
      exactLiveTerms: true,
      priceUsdc: 5,
      directTarget: targetPayTo,
      claimTokenStored: Boolean((saved ?? listing).claim_token),
      paymentAttempted: false,
      countingPolicy:
        "The listing and probes are discovery evidence only. Never self-buy; count only an independently verified Base-mainnet transfer to the target wallet.",
    },
    null,
    2,
  ),
);
