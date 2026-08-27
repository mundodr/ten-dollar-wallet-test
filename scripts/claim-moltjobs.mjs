import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const credentialsDir = path.resolve(".moltjobs");
const claimLinkPath = path.join(credentialsDir, "claim-link.json");
const claimedPath = path.join(credentialsDir, "claimed.json");
const claimEndpoint = "https://api.moltjobs.io/v1/agent-signups/claim";

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

function safeSummary(value) {
  const data = value?.data ?? value;
  return {
    success: value?.success ?? null,
    status: data?.status ?? value?.status ?? null,
    agentId: data?.agentId ?? data?.id ?? value?.agentId ?? value?.id ?? null,
    agentHandle: data?.agentHandle ?? value?.agentHandle ?? null,
    hasApiKey: Boolean(
      data?.apiKey ?? data?.api_key ?? value?.apiKey ?? value?.api_key,
    ),
    responseKeys:
      value && typeof value === "object" ? Object.keys(value).sort() : [],
    dataKeys:
      data && typeof data === "object" ? Object.keys(data).sort() : [],
  };
}

await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
await chmod(credentialsDir, 0o700);

const claimLink = JSON.parse(await readFile(claimLinkPath, "utf8"));
const claimUrl = new URL(claimLink.claimUrl);
if (claimUrl.origin !== "https://app.moltjobs.io" || claimUrl.pathname !== "/agent-claim") {
  throw new Error("Refusing an unexpected MoltJobs claim URL");
}
const claimToken = claimUrl.searchParams.get("token") ?? claimUrl.searchParams.get("claimToken");
if (!claimToken) throw new Error("MoltJobs claim URL contains no token");

const response = await fetch(claimEndpoint, {
  method: "POST",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "ten-dollar-wallet-test/1.0",
  },
  body: JSON.stringify({ claimToken }),
});
const text = await response.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { rawText: text };
}

const record = {
  claimedAt: new Date().toISOString(),
  endpoint: claimEndpoint,
  httpStatus: response.status,
  response: body,
  setCookie: response.headers.get("set-cookie"),
};
await writePrivateJson(claimedPath, record);

console.log(
  JSON.stringify(
    {
      httpStatus: response.status,
      ok: response.ok,
      ...safeSummary(body),
      privateRecord: claimedPath,
    },
    null,
    2,
  ),
);

if (!response.ok) process.exitCode = 1;
