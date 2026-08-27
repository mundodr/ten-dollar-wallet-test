import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://agentpaystore.com";
const endpointUrl =
  "https://simply-technician-crowd-newton.trycloudflare.com/invoke";
const paymentAddress = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const serviceName = "API Brief Acceptance Checklist";
const privateDir = path.resolve(".agentpaystore");
const statePath = path.join(privateDir, "credentials.json");
const mailboxPath = path.resolve(".moltjobs/mailbox.json");

async function getListings() {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/custom/api/listings`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && Array.isArray(body?.listings)) return body.listings;
      lastError = new Error(`AgentPay Store returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError ?? new Error("AgentPay Store returned no listing catalog");
}

function findExact(listings) {
  return listings.find(
    (listing) =>
      listing.name === serviceName && listing.endpoint_url === endpointUrl,
  );
}

await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);

const existing = findExact(await getListings());
if (existing) {
  console.log(
    JSON.stringify({
      reused: true,
      listingId: existing.id,
      slug: existing.slug,
      status: existing.status,
      pricePerCall: existing.price_per_call,
      totalCalls: existing.total_calls,
    }),
  );
  process.exit(0);
}

const mailbox = JSON.parse(await readFile(mailboxPath, "utf8"));
const response = await fetch(`${baseUrl}/custom/api/register`, {
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json" },
  body: JSON.stringify({
    name: serviceName,
    description:
      "Compile an English or Chinese API brief into deterministic JSON acceptance criteria, assumptions, edge cases, open questions, and six executable-style test scenarios. No retention and no external model key required.",
    category: "custom",
    emoji: "🧪",
    endpoint_url: endpointUrl,
    price_per_call: 0.01,
    payment_address: paymentAddress,
    developer_name: "Ten Dollar Wallet Worker",
    developer_email: mailbox.address,
    schema_url: "",
    tags: ["api", "testing", "validation", "json", "bilingual"],
  }),
  signal: AbortSignal.timeout(30_000),
});
const body = await response.json().catch(() => null);
if (!response.ok || !body?.api_key) {
  throw new Error(
    `AgentPay Store registration failed (${response.status}): ${body?.error ?? "unknown"}`,
  );
}

const listing = findExact(await getListings());
if (!listing) {
  throw new Error("AgentPay Store did not publish the registered service");
}

await writeFile(
  statePath,
  `${JSON.stringify(
    {
      ...body,
      listingId: listing.id,
      slug: listing.slug,
      endpointUrl,
      paymentAddress,
      developerEmail: mailbox.address,
      registeredAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
await chmod(statePath, 0o600);

console.log(
  JSON.stringify({
    reused: false,
    registered: true,
    listingId: listing.id,
    slug: listing.slug,
    status: listing.status,
    pricePerCall: listing.price_per_call,
    paymentAddressMatches: paymentAddress ===
      "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18",
    apiKeyStored: true,
  }),
);
