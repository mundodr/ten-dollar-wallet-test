import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

const apiBase = "https://x402-api.onrender.com";
const serviceUrl =
  "https://simply-technician-crowd-newton.trycloudflare.com/x402";
const targetBaseWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const price = 0.01;
const stateDirectory = path.resolve(".x402bazaar");
const credentialsPath = path.join(stateDirectory, "credentials.json");
const registrationPath = path.join(stateDirectory, "registration.json");

const hex = (bytes) => Buffer.from(bytes).toString("hex");

function ethereumAddress(privateKey) {
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  return `0x${hex(keccak_256(publicKey.subarray(1)).subarray(12))}`;
}

function personalSign(message, privateKey) {
  const messageBytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(
    `\x19Ethereum Signed Message:\n${messageBytes.length}`,
  );
  const digest = keccak_256(Buffer.concat([prefix, messageBytes]));
  const recovered = secp256k1.sign(digest, privateKey, {
    format: "recovered",
    prehash: false,
  });
  const recovery = recovered[0];
  const compact = recovered.subarray(1);
  return `0x${hex(Buffer.concat([compact, Buffer.from([27 + recovery])]))}`;
}

async function readJson(filename) {
  try {
    return JSON.parse(await fs.readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function loadOrCreateCredentials() {
  await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const saved = await readJson(credentialsPath);
  if (saved?.privateKey) {
    const privateKey = Buffer.from(saved.privateKey.replace(/^0x/, ""), "hex");
    const signerAddress = ethereumAddress(privateKey);
    if (saved.signerAddress?.toLowerCase() !== signerAddress) {
      throw new Error("Saved x402Bazaar signer address does not match its key");
    }
    return { privateKey, signerAddress };
  }

  const privateKey = crypto.randomBytes(32);
  if (!secp256k1.utils.isValidSecretKey(privateKey)) {
    return loadOrCreateCredentials();
  }
  const signerAddress = ethereumAddress(privateKey);
  await fs.writeFile(
    credentialsPath,
    `${JSON.stringify(
      {
        signerAddress,
        privateKey: `0x${hex(privateKey)}`,
        purpose:
          "Dedicated x402Bazaar settlement signer; any genuine payout must be forwarded to the disclosed Base target.",
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return { privateKey, signerAddress };
}

const existing = await readJson(registrationPath);
if (existing?.service?.id) {
  console.log(
    JSON.stringify(
      {
        status: "already_registered",
        signerAddress: existing.signerAddress,
        settlementWallet: existing.settlementWallet,
        forwardingTarget: existing.forwardingTarget,
        service: existing.service,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const { privateKey, signerAddress } = await loadOrCreateCredentials();
// x402Bazaar requires the wallet receiving its later batched settlement to sign
// the listing. The disclosed target wallet is not controlled by this worker, so
// use a dedicated intermediary that can forward any genuine payout to the
// target. An intermediary balance is never counted as goal progress.
const settlementWallet = signerAddress;

const catalogResponse = await fetch(`${apiBase}/api/services`, {
  headers: { "user-agent": "ten-dollar-wallet-worker/1.0" },
});
if (!catalogResponse.ok) {
  throw new Error(
    `x402Bazaar service database is unavailable (${catalogResponse.status}); registration was not retried`,
  );
}
const catalogBody = await catalogResponse.json();
const catalog = Array.isArray(catalogBody)
  ? catalogBody
  : (catalogBody.data ?? catalogBody.services ?? []);
const priorService = catalog.find(
  (service) =>
    service?.url === serviceUrl &&
    service?.owner_address?.toLowerCase() === settlementWallet,
);
if (priorService) {
  const savedRegistration = {
    registeredAt: priorService.created_at ?? null,
    recoveredAt: new Date().toISOString(),
    apiBase,
    signerAddress,
    settlementWallet,
    forwardingTarget: targetBaseWallet,
    serviceUrl,
    price,
    service: priorService,
    rawResponse: { recoveredFromCatalog: true },
  };
  await fs.writeFile(
    registrationPath,
    `${JSON.stringify(savedRegistration, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      { status: "recovered_existing_registration", ...savedRegistration },
      null,
      2,
    ),
  );
  process.exit(0);
}

const timestamp = Date.now();
const message = `quick-register:${serviceUrl}:${settlementWallet}:${timestamp}`;
const signature = personalSign(message, privateKey);
const response = await fetch(`${apiBase}/quick-register`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "user-agent": "ten-dollar-wallet-worker/1.0",
  },
  body: JSON.stringify({
    url: serviceUrl,
    price,
    ownerAddress: settlementWallet,
    signature,
    timestamp,
  }),
});
const responseText = await response.text();
let body;
try {
  body = JSON.parse(responseText);
} catch {
  body = { raw: responseText };
}
if (!response.ok) {
  throw new Error(
    `x402Bazaar registration failed (${response.status}): ${JSON.stringify(body)}`,
  );
}

const service = body.service ?? body.data ?? body;
const savedRegistration = {
  registeredAt: new Date().toISOString(),
  apiBase,
  signerAddress,
  settlementWallet,
  forwardingTarget: targetBaseWallet,
  serviceUrl,
  price,
  service,
  rawResponse: body,
};
await fs.writeFile(
  registrationPath,
  `${JSON.stringify(savedRegistration, null, 2)}\n`,
  { mode: 0o600 },
);

console.log(
  JSON.stringify(
    {
      status: "registered",
      signerAddress,
      settlementWallet,
      forwardingTarget: targetBaseWallet,
      service,
    },
    null,
    2,
  ),
);
