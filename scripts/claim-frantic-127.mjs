import { constants } from "node:fs";
import { access, chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const credentialsPath = path.resolve(".frantic/credentials.json");
const statePath = path.resolve(".frantic/bounty-127.json");
const commit = "2ddda0261aef5510694efdfadb078c4c25489cb8";
const publicUrl =
  "https://medium.com/@ten-dollar-wallet-lab/from-one-openapi-file-to-a-searchable-static-docs-site-008c4becb645";
const artifactRefs = [
  `public_url=${publicUrl}`,
  `evidence_json=https://raw.githubusercontent.com/mundodr/ten-dollar-wallet-test/${commit}/deliverables/frantic/127-sourcey-article/evidence.json`,
  `report=https://raw.githubusercontent.com/mundodr/ten-dollar-wallet-test/${commit}/deliverables/frantic/127-sourcey-article/report.md`,
];

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function requestJson(pathname, options = {}, expectedStatuses = [200]) {
  const response = await fetch(`https://gofrantic.com${pathname}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "User-Agent": "ten-dollar-wallet-worker/1.0",
      ...options.headers,
    },
    signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json().catch(() => null);
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(
      `Frantic returned HTTP ${response.status} for ${pathname}: ${body?.error ?? body?.message ?? "unknown"}`,
    );
  }
  return body;
}

async function writeState(state) {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await chmod(statePath, 0o600);
}

const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
let state = (await exists(statePath))
  ? JSON.parse(await readFile(statePath, "utf8"))
  : null;

if (state?.delivery) {
  console.log(
    JSON.stringify({ alreadyDelivered: true, claimId: state.claimId, delivery: state.delivery }, null, 2),
  );
  process.exit(0);
}
if (state?.deliveryAttemptedAt) {
  throw new Error(
    "A delivery attempt is already recorded without a confirmed response; refusing to retry it",
  );
}

if (!state) {
  const [status, bounty] = await Promise.all([
    requestJson(`/v1/agents/${encodeURIComponent(credentials.agentKid)}/status`),
    requestJson("/v1/bounties/127"),
  ]);
  const agent = status?.agent;
  if (status?.verification?.seals?.signal?.state !== "sealed") {
    throw new Error("Frantic contact identity is not sealed");
  }
  if (agent?.claimEligibility?.eligible !== true) {
    throw new Error("Frantic agent is not eligible for bounty 127");
  }
  if (
    agent?.onboarding?.payout?.set !== true ||
    agent?.onboarding?.payout?.rail !== "x402" ||
    credentials.payoutHint !== "0x4244..ad18"
  ) {
    throw new Error("Frantic payout no longer matches the locked Base target");
  }
  if (Number(status?.work?.summary?.active ?? 0) !== 0) {
    throw new Error("Frantic already reports active work; refusing a duplicate claim");
  }
  if (
    bounty?.bounty?.number !== 127 ||
    bounty?.bounty?.funded !== true ||
    bounty?.actions?.claim?.available !== true ||
    Number(bounty?.bounty?.claim_progress?.available ?? 0) < 1
  ) {
    throw new Error("Frantic bounty 127 is not funded and claimable with an open slot");
  }

  const claim = await requestJson("/v1/claims", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bounty: 127,
      agent_kid: credentials.agentKid,
      agent_token: credentials.agentToken,
    }),
  });
  if (claim?.ok !== true || !claim?.claim_id) {
    throw new Error("Frantic did not return a confirmed claim id");
  }
  state = {
    bounty: 127,
    claimId: claim.claim_id,
    claimRef: claim.claim_ref ?? null,
    claimedAt: new Date().toISOString(),
    fuseExpiresAt: claim.fuse_expires_at ?? null,
    artifactRefs,
  };
  await writeState(state);
}

const preflight = await requestJson("/v1/deliveries/preflight", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ claim_id: state.claimId, artifact_refs: artifactRefs }),
});
if (preflight?.preflight?.ok !== true) {
  throw new Error(`Frantic delivery preflight failed: ${JSON.stringify(preflight)}`);
}

state = { ...state, deliveryAttemptedAt: new Date().toISOString(), preflight };
await writeState(state);
const delivery = await requestJson("/v1/deliveries", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    claim_id: state.claimId,
    agent_kid: credentials.agentKid,
    agent_token: credentials.agentToken,
    artifact_refs: artifactRefs,
  }),
});
if (delivery?.ok !== true) {
  throw new Error("Frantic did not confirm the delivery");
}
state = { ...state, deliveredAt: new Date().toISOString(), delivery };
await writeState(state);

console.log(
  JSON.stringify(
    {
      bounty: 127,
      claimId: state.claimId,
      claimRef: state.claimRef,
      fuseExpiresAt: state.fuseExpiresAt,
      deliveredAt: state.deliveredAt,
      delivery,
      countingPolicy:
        "Claim and delivery are work evidence only; count only a verified mainnet target-wallet receipt.",
    },
    null,
    2,
  ),
);
