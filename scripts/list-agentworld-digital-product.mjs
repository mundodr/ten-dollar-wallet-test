import { constants } from "node:fs";
import { access, chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://agentworld.me/api/agentworld";
const targetWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const credentialsPath = path.resolve(".agentworld/credentials.json");
const statePath = path.resolve(".agentworld/digital-store-product.json");
const product = {
  title: "Safe Public JSON Extraction & Validation Kit",
  description:
    "Open-source, standard-library-only Python kit for one explicitly authorized public JSON API: exact-host and public-IP guards, redirect rejection, bounded responses, deterministic JSON/CSV output, revalidation, documentation, and seven tests. No credentials, private networks, paywall bypass, or prohibited scraping.",
  category: "software",
  price_usdc: 12.5,
  file_url:
    "https://github.com/mundodr/ten-dollar-wallet-test/tree/main/deliverables/agentpact/public-json-extractor",
  cover_emoji: "🛡️",
};

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function request(endpoint, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        headers: { Accept: "application/json", ...options.headers },
        signal: AbortSignal.timeout(25_000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          `AgentWorld returned HTTP ${response.status}: ${JSON.stringify(body)}`,
        );
      }
      return body;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError ?? new Error("AgentWorld returned no response");
}

const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
const statusResponse = await request(
  `/agent/status/${encodeURIComponent(credentials.agentId)}`,
);
const agent = statusResponse?.agent ?? statusResponse;
const agentWallet = agent?.agent_wallet ?? agent?.wallet ?? credentials.wallet ?? null;
if (agentWallet?.toLowerCase() !== targetWallet) {
  throw new Error("AgentWorld seller profile is not bound to the target Base address");
}

let state = null;
if (await exists(statePath)) {
  state = JSON.parse(await readFile(statePath, "utf8"));
}

const beforeResponse = await request("/digital-store/products");
const before = beforeResponse?.products ?? [];
let listing = before.find(
  (row) =>
    row.id === state?.productId ||
    (row.seller_id === credentials.agentId && row.title === product.title),
);
let reused = Boolean(listing);

if (state && !listing) {
  throw new Error(
    "Saved AgentWorld product is outside the capped public catalog response; refusing to create a duplicate",
  );
}

if (!listing) {
  const created = await request("/digital-store/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seller_id: credentials.agentId, ...product }),
  });
  if (!created?.success || !created?.product_id) {
    throw new Error(`AgentWorld did not confirm the product listing: ${JSON.stringify(created)}`);
  }
  const afterResponse = await request("/digital-store/products");
  listing = (afterResponse?.products ?? []).find(
    (row) => row.id === created.product_id,
  );
  if (!listing) {
    throw new Error("AgentWorld created the product but did not return it in the catalog");
  }
}

const exact =
  listing.seller_id === credentials.agentId &&
  listing.title === product.title &&
  listing.description === product.description &&
  listing.category === product.category &&
  Number(listing.price_usdc) === product.price_usdc &&
  listing.file_url === product.file_url;
if (!exact) {
  throw new Error("Existing AgentWorld product does not exactly match the owned listing");
}

state = {
  productId: listing.id,
  agentId: credentials.agentId,
  targetWallet,
  title: product.title,
  priceUsdc: product.price_usdc,
  sellerShare: 0.8,
  expectedSellerAmountPerPurchaseUsdc: product.price_usdc * 0.8,
  productUrl: `https://agentworld.me/buy#digishop`,
  fileUrl: product.file_url,
  createdAt: state?.createdAt ?? listing.created_at ?? new Date().toISOString(),
  checkedAt: new Date().toISOString(),
};
await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
await chmod(statePath, 0o600);

console.log(
  JSON.stringify(
    {
      listed: true,
      reused,
      productId: listing.id,
      title: listing.title,
      category: listing.category,
      priceUsdc: listing.price_usdc,
      sellerIdMatches: listing.seller_id === credentials.agentId,
      sellerWalletMatches: agentWallet.toLowerCase() === targetWallet,
      sellerShare: "80%",
      expectedSellerAmountPerPurchaseUsdc: product.price_usdc * 0.8,
      status: listing.status,
      verified: listing.verified,
      purchases: listing.purchases,
      revenueUsdc: listing.revenue_usdc,
      sellerPayoutUsdc: listing.seller_payout_usdc,
      productUrl: state.productUrl,
      fileUrl: listing.file_url,
      statePath,
    },
    null,
    2,
  ),
);
