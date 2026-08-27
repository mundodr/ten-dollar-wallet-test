import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const siteBase = "https://payapi.market";
const credentialsPath = path.resolve(".frantic/credentials.json");
const privateDir = path.resolve(".payapimarket");
const submissionPath = path.join(privateDir, "submission-v2.json");
const statePath = path.join(privateDir, "state.json");
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const directX402Url =
  "https://payanagent.com/x402/kh7ezjzt4etk8x1s908z7wngqn8d89hx";
const listingName = "Deterministic API Brief Acceptance Checklist";

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${siteBase}${pathname}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`PayAPI Market ${pathname} failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function findProjectEmail(value) {
  if (!value || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value)) {
    if (/email/i.test(key) && typeof item === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item)) {
      return item.toLowerCase();
    }
    const nested = findProjectEmail(item);
    if (nested) return nested;
  }
  return null;
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);

const projectCredentials = JSON.parse(await readFile(credentialsPath, "utf8"));
const projectEmail = findProjectEmail(projectCredentials);
if (!projectEmail) throw new Error("The verified project mailbox was not found");

let submission = await readOptionalJson(submissionPath);
let submitted = false;
if (!submission) {
  submission = await requestJson("/api/submit-listing", {
    method: "POST",
    body: JSON.stringify({
      provider: {
        name: "Ten Dollar Wallet Lab",
        email: projectEmail,
        company_name: "",
        wallet_address: targetBaseWallet,
      },
      api: {
        name: listingName,
        description:
          "Turn a compact API endpoint brief into deterministic acceptance criteria, failure checks, six test cases, edge cases, and open questions.",
        category: "Tools",
        base_url: directX402Url,
        mcp_endpoint: "",
        endpoints_count: "1",
        tools_count: "1",
        price_min: "0.01",
        price_max: "0.01",
      },
      tier: "free",
    }),
  });
  await writePrivateJson(submissionPath, submission);
  submitted = true;
}

const login = await requestJson("/api/provider-login", {
  method: "POST",
  body: JSON.stringify({ email: projectEmail }),
});
if (!login.token) throw new Error("PayAPI Market provider login omitted its token");
const dashboard = await requestJson("/api/get-provider", {
  method: "POST",
  headers: { Authorization: `Bearer ${login.token}` },
  body: JSON.stringify({ email: projectEmail }),
});
const provider = dashboard.provider;
const listings = dashboard.listings ?? [];
const listing = listings.find(
  (item) => item.name === listingName && item.base_url === directX402Url,
);
if (!provider || !listing) throw new Error("PayAPI Market dashboard omitted the submitted listing");
if (provider.wallet_address?.toLowerCase() !== targetBaseWallet) {
  throw new Error("PayAPI Market payout wallet does not match the target Base address");
}

const state = {
  checkedAt: new Date().toISOString(),
  providerId: provider.id,
  listingId: listing.id,
  listingName: listing.name,
  baseUrl: listing.base_url,
  tier: provider.tier,
  providerStatus: provider.status,
  listingStatus: listing.status,
  paymentVerified: listing.payment_verified ?? false,
  paymentVerifiedAt: listing.payment_verified_at ?? null,
  verificationTxHash: listing.verification_tx_hash ?? null,
  healthStatus: listing.health_status ?? null,
  exactBaseWallet: true,
};
await writePrivateJson(statePath, state);

console.log(
  JSON.stringify(
    {
      submitted,
      providerId: state.providerId,
      listingId: state.listingId,
      listingName: state.listingName,
      exactBaseWallet: state.exactBaseWallet,
      tier: state.tier,
      providerStatus: state.providerStatus,
      listingStatus: state.listingStatus,
      paymentVerified: state.paymentVerified,
      verificationTxHash: state.verificationTxHash,
      healthStatus: state.healthStatus,
      note:
        "The free listing is eligible for an operator-funded real x402 verification call; no self-payment was made.",
    },
    null,
    2,
  ),
);
