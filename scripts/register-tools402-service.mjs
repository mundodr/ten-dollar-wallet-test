import fs from "node:fs/promises";
import path from "node:path";
import { keccak256, recoverTypedDataAddress, toBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const apiBase = "https://api.tools402.dev";
const slug = "ten-dollar-wallet-lab";
const pathSuffix = "api-brief-checklist";
const targetPath = `/v1/${slug}/${pathSuffix}`;
const upstreamUrl =
  "https://begins-greatly-badge-dealers.trycloudflare.com/";
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const stateDirectory = path.resolve(".tools402");
const credentialsPath = path.join(stateDirectory, "credentials.json");
const registrationPath = path.join(stateDirectory, "registration.json");
const domain = { name: "tools402", version: "1", chainId: 8453 };
const types = {
  SellerAction: [
    { name: "wallet", type: "address" },
    { name: "action", type: "string" },
    { name: "payloadHash", type: "bytes32" },
    { name: "timestamp", type: "uint256" },
  ],
};
const endpoint = {
  path_suffix: pathSuffix,
  upstream_url: upstreamUrl,
  atomic_price: 10_000,
  unit: "call",
  desc: "Compile an English or Chinese API brief into deterministic acceptance criteria and six JSON test scenarios.",
  mode: "proxy",
};

async function readJson(filename) {
  try {
    return JSON.parse(await fs.readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writePrivateJson(filename, value) {
  await fs.writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.chmod(filename, 0o600);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20_000),
    headers: {
      "user-agent": "ten-dollar-wallet-worker/1.0",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { response, body };
}

await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
let credentials = await readJson(credentialsPath);
if (!credentials?.privateKey) {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  credentials = {
    wallet: account.address,
    privateKey,
    purpose:
      "Dedicated tools402 seller and settlement wallet; any genuine payout must be forwarded to the disclosed Base target.",
    forwardingTarget: targetBaseWallet,
  };
  await writePrivateJson(credentialsPath, credentials);
}

const account = privateKeyToAccount(credentials.privateKey);
if (account.address.toLowerCase() !== credentials.wallet?.toLowerCase()) {
  throw new Error("Saved tools402 wallet does not match its private key");
}
if (credentials.forwardingTarget?.toLowerCase() !== targetBaseWallet) {
  throw new Error("Saved tools402 forwarding target does not match the goal");
}

async function signSellerAction(action, payloadHash, timestamp) {
  const message = {
    wallet: account.address,
    action,
    payloadHash,
    timestamp: BigInt(timestamp),
  };
  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: "SellerAction",
    message,
  });
  const recovered = await recoverTypedDataAddress({
    domain,
    types,
    primaryType: "SellerAction",
    message,
    signature,
  });
  if (recovered.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`Local tools402 ${action} signature verification failed`);
  }
  return signature;
}

let metaResult;
try {
  metaResult = await fetchJson(`${apiBase}/v1/_meta`);
} catch (error) {
  throw new Error(`tools402 API is unavailable; no registration attempted: ${error.message}`);
}
if (!metaResult.response.ok) {
  throw new Error(
    `tools402 catalog is unavailable (${metaResult.response.status}); no registration attempted`,
  );
}
const endpoints = Array.isArray(metaResult.body?.endpoints)
  ? metaResult.body.endpoints
  : [];
const pathOwner = endpoints.find((item) => item?.path === targetPath);
if (
  pathOwner &&
  pathOwner.seller?.toLowerCase() !== account.address.toLowerCase()
) {
  throw new Error(`tools402 path ${targetPath} belongs to another seller`);
}

const alreadySeller = endpoints.some(
  (item) => item?.seller?.toLowerCase() === account.address.toLowerCase(),
);
if (!alreadySeller) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signSellerAction(
    "register",
    keccak256(toBytes(slug)),
    timestamp,
  );
  const result = await fetchJson(`${apiBase}/v1/_seller/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wallet: account.address,
      slug,
      signature,
      timestamp,
    }),
  });
  if (!result.response.ok) {
    throw new Error(
      `tools402 seller registration failed (${result.response.status}): ${JSON.stringify(result.body)}`,
    );
  }
}

let endpointRecord = pathOwner ?? null;
if (!endpointRecord) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signSellerAction(
    "add_endpoint",
    keccak256(toBytes(JSON.stringify(endpoint))),
    timestamp,
  );
  const result = await fetchJson(
    `${apiBase}/v1/_seller/${account.address}/endpoints`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...endpoint, signature, timestamp }),
    },
  );
  if (!result.response.ok) {
    throw new Error(
      `tools402 endpoint registration failed (${result.response.status}): ${JSON.stringify(result.body)}`,
    );
  }
  endpointRecord = result.body?.endpoint ?? result.body;
}

const registration = {
  registeredAt: new Date().toISOString(),
  apiBase,
  sellerWallet: account.address,
  forwardingTarget: targetBaseWallet,
  targetPath,
  publicUrl: `${apiBase}${targetPath}`,
  endpoint,
  endpointRecord,
};
await writePrivateJson(registrationPath, registration);
console.log(
  JSON.stringify(
    {
      status: pathOwner ? "already_registered" : "registered",
      sellerWallet: account.address,
      forwardingTarget: targetBaseWallet,
      publicUrl: registration.publicUrl,
      endpointRecord,
    },
    null,
    2,
  ),
);
