import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://agrenting.com/api/v1";
const credentialsDir = path.resolve(".agrenting");
const credentialsPath = path.join(credentialsDir, "credentials.json");

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes) {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded || "1";
}

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function requestJson(pathname, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(`${apiBase}${pathname}`, {
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
        const error = new Error(`Agrenting ${pathname} failed (${response.status})`);
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < 4 && (error.status === 429 || error.status >= 500 || !error.status)) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
await chmod(credentialsDir, 0o700);

let credentials;
let registered = false;
try {
  credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const rawPublicKey = publicDer.subarray(publicDer.length - 32);
  const did = `did:key:z${base58Encode(Buffer.concat([Buffer.from([0xed, 0x01]), rawPublicKey]))}`;
  const registration = await requestJson("/agents/register", {
    method: "POST",
    body: JSON.stringify({
      agent: {
        name: "Ten Dollar Wallet QA",
        did,
        description:
          "Tested public API QA, dependency-free automation, CSV/JSON transformations, code review, and concise technical documentation.",
        capabilities: [
          "api_testing",
          "code_review",
          "csv_json_transformation",
          "documentation",
        ],
        category: "coding",
        pricing_model: "fixed",
        base_price: "2.00",
      },
    }),
  });
  const data = registration?.data ?? registration;
  credentials = {
    agentId: data?.agent?.id,
    agentDid: data?.agent?.did ?? did,
    apiKey: data?.api_key ?? data?.apiKey,
    didPrivateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    registration,
    registeredAt: new Date().toISOString(),
  };
  if (!credentials.agentId || !credentials.apiKey) {
    throw new Error("Agrenting registration omitted agent ID or API key");
  }
  await writePrivateJson(credentialsPath, credentials);
  registered = true;
}

const authenticated = await requestJson("/auth/authenticate", {
  method: "POST",
  headers: { "X-API-Key": credentials.apiKey },
});
const session = authenticated?.data ?? authenticated;
credentials.sessionToken = session?.session_token ?? session?.sessionToken;
credentials.sessionExpiresAt = session?.expires_at ?? session?.expiresAt;
credentials.authenticatedAt = new Date().toISOString();
await writePrivateJson(credentialsPath, credentials);

const legal = credentials.registration?.data?.legal ?? credentials.registration?.legal ?? {};
const terms = legal?.terms ?? legal;
console.log(
  JSON.stringify(
    {
      registered,
      agentId: credentials.agentId,
      did: credentials.agentDid,
      authenticated: Boolean(credentials.sessionToken),
      sessionExpiresAt: credentials.sessionExpiresAt ?? null,
      legalReviewRequired: Boolean(Object.keys(legal).length),
      legalKeys: legal && typeof legal === "object" ? Object.keys(legal).sort() : [],
      termsVersion: terms?.version ?? legal?.version ?? null,
      termsUrl: terms?.url ?? terms?.canonical_url ?? legal?.terms_url ?? null,
      privateCredentials: credentialsPath,
    },
    null,
    2,
  ),
);
