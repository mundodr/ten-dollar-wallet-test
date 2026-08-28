import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://agoragentic.com/api";
const credentialsPath = path.resolve(".agoragentic/credentials.json");
const servicePath = path.resolve(".agoragentic/service.json");
const targetWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const serviceName = "Deterministic API Acceptance Checklist";

const sourceCode = String.raw`function handler(input) {
  const brief = String(input && (input.brief || input.text || input.requirements) || "")
    .replace(/\s+/g, " ").trim().slice(0, 12000);
  if (!brief) throw new Error("brief must be a non-empty string");
  const method = (brief.toUpperCase().match(/\b(GET|POST|PUT|PATCH|DELETE)\b/) || [])[1] || null;
  const endpoint = (brief.match(/\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%-]+\/?){1,8}/) || [])[0] || null;
  const subject = [method, endpoint].filter(Boolean).join(" ") || "the described API operation";
  const requirements = [
    "Contract-valid input succeeds and returns a parseable response.",
    "Missing required fields, wrong types, and out-of-range values are rejected with stable errors.",
    "Failed requests leave no undocumented partial write or inconsistent state.",
    "Responses expose no credentials, internal stack traces, or unauthorized data."
  ];
  if (/auth|bearer|oauth|jwt|permission|role/i.test(brief)) requirements.push("Unauthenticated and unauthorized callers are rejected consistently.");
  if (/paginat|cursor|page size|limit|offset/i.test(brief)) requirements.push("Pagination boundaries produce no duplicates or omissions.");
  if (/idempoten|retry/i.test(brief)) requirements.push("Retrying the same idempotent request creates no duplicate side effect.");
  return {
    summary: "Acceptance checklist for " + subject,
    assumptions: [
      ...(method ? [] : ["HTTP method must be confirmed."]),
      ...(endpoint ? [] : ["Endpoint path must be confirmed."])
    ],
    acceptance_criteria: requirements.map((requirement, index) => ({
      id: "AC-" + (index + 1), requirement,
      verification: "Assert with an isolated request and observable response or state."
    })),
    test_cases: [
      { id: "TC-1", type: "happy_path", action: "Call " + subject + " with minimum valid input.", expected: "Success response parses and satisfies declared constraints." },
      { id: "TC-2", type: "validation", action: "Remove each required field in turn.", expected: "Each invalid request is rejected with a field-specific error." },
      { id: "TC-3", type: "security", action: "Call without authentication and with insufficient authorization.", expected: "Access is denied without sensitive detail leakage." }
    ]
  };
}`;

async function request(pathname, { method = "GET", body, apiKey } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Agoragentic ${pathname} failed (${response.status}): ${payload?.error ?? payload?.message ?? "unknown error"}`,
    );
  }
  return payload;
}

const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
if (credentials.targetWallet?.toLowerCase() !== targetWallet) {
  throw new Error("Agoragentic forwarding target does not match the approved Base address");
}

const [sellerStatus, relayBody, listingBody] = await Promise.all([
  request("/seller/status", { apiKey: credentials.apiKey }),
  request("/relay", { apiKey: credentials.apiKey }),
  request(
    `/capabilities?seller=${encodeURIComponent(credentials.agentId)}&visibility=registry&include_showcase=true&limit=200`,
    { apiKey: credentials.apiKey },
  ),
]);
const relays = relayBody.functions ?? relayBody.relays ?? relayBody.items ?? [];
const listings = listingBody.capabilities ?? listingBody.items ?? [];
let relay = relays.find((item) => item.name === serviceName) ?? null;
let listing = listings.find((item) => item.name === serviceName) ?? null;

if (!relay && !listing) {
  const seller = sellerStatus.seller ?? sellerStatus;
  if (
    Number(seller.free_concurrent_slots_remaining ?? 0) < 1 ||
    seller.stake_required_for_next_listing ||
    Number(seller.stake_amount_due_now_usdc ?? 0) > 0
  ) {
    throw new Error("Agoragentic free-slot guard refused a paid or staked publication");
  }
  const deployed = await request("/relay/deploy", {
    method: "POST",
    apiKey: credentials.apiKey,
    body: {
      name: serviceName,
      description:
        "Turn an English API brief into deterministic acceptance criteria, assumptions, and three concrete QA test cases. Stateless pure computation with no retention or external network access.",
      source_code: sourceCode,
      entry_point: "handler",
      auto_list: true,
      category: "developer-tools",
      pricing_model: "per_call",
      price: 0.1,
      input_schema: {
        type: "object",
        required: ["brief"],
        properties: {
          brief: {
            type: "string",
            minLength: 1,
            maxLength: 12000,
            description: "API feature brief, endpoint contract, or bug report.",
          },
        },
        additionalProperties: false,
      },
      sandbox_probe_input: {
        brief:
          "POST /v1/orders requires bearer auth and idempotent retries; success is HTTP 201 JSON.",
      },
      output_schema: {
        type: "object",
        required: [
          "summary",
          "assumptions",
          "acceptance_criteria",
          "test_cases",
        ],
        properties: {
          summary: { type: "string" },
          assumptions: { type: "array", items: { type: "string" } },
          acceptance_criteria: { type: "array", items: { type: "object" } },
          test_cases: { type: "array", items: { type: "object" } },
        },
      },
    },
  });
  relay = deployed.function ?? deployed.relay ?? deployed;
  listing = deployed.listing ?? deployed.capability ?? null;
  await writeFile(
    servicePath,
    `${JSON.stringify(
      {
        serviceName,
        relayId: relay?.id ?? relay?.function_id ?? deployed.function_id ?? null,
        listingId: listing?.id ?? deployed.listing_id ?? null,
        createdAt: new Date().toISOString(),
        targetWallet,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}

const refreshed = await request(
  `/capabilities?seller=${encodeURIComponent(credentials.agentId)}&visibility=registry&include_showcase=true&limit=200`,
  { apiKey: credentials.apiKey },
);
listing = (refreshed.capabilities ?? refreshed.items ?? []).find(
  (item) => item.name === serviceName,
) ?? listing;

console.log(
  JSON.stringify(
    {
      status: "published-or-adopted",
      agentId: credentials.agentId,
      relayId: relay?.id ?? relay?.function_id ?? null,
      listingId: listing?.id ?? null,
      listingStatus: listing?.status ?? null,
      reviewStatus: listing?.review_status ?? null,
      priceUsdc: listing?.price_per_unit ?? 0.1,
      targetWallet,
      exactForwardingTarget: credentials.targetWallet.toLowerCase() === targetWallet,
      noStakeUsed: true,
      countingPolicy:
        "A listing, invocation, receipt, or internal balance is not goal funds; only a matching Base-mainnet target transfer counts.",
    },
    null,
    2,
  ),
);
