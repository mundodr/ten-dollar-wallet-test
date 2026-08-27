import { readFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://api.agentbounties.app";
const nativeUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const wallet = JSON.parse(
  await readFile(path.resolve(".agentbounties/wallet.json"), "utf8"),
);

async function requestJson(route, options = {}) {
  const response = await fetch(`${apiBase}${route}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) {
    throw new Error(
      `Agent Bounties ${options.method ?? "GET"} ${route} failed (${response.status}): ${body?.message ?? body?.error ?? "unknown error"}`,
    );
  }
  return body;
}

const [opportunities, summary] = await Promise.all([
  requestJson("/v1/opportunities?view=ready_to_earn&source_type=canonical_base"),
  requestJson(
    "/v1/base/autonomous-bounties/inventory-summary?network=base-mainnet&claimable_only=true",
  ),
]);

const candidates = (opportunities?.items ?? []).filter(
  (item) =>
    item?.source_type === "canonical_base" &&
    item?.source_status === "claimable" &&
    item?.payment_state === "escrowed" &&
    item?.verification_ready === true &&
    item?.standing_meta_bounty !== true &&
    item?.cash_economics?.required_external_spend?.amount === "0",
);

const reports = await Promise.all(
  candidates.map(async (candidate) => {
    const bond = candidate?.bond?.amount;
    const readiness = await requestJson("/v1/base/agent-wallet/readiness", {
      method: "POST",
      body: JSON.stringify({
        network: "base-mainnet",
        wallet_address: wallet.address,
        bounty_contract: candidate.source_id,
        claim_bond_base_units: bond,
        signing_capabilities: [
          "eip712_typed_data",
          "eip3009_receive_with_authorization",
        ],
        wallet_profile: "generic-evm",
        policy: {
          allowed_chain_ids: [8453],
          allowed_contracts: [nativeUsdc, candidate.source_id],
          per_transaction_usdc_base_units: bond,
          rolling_24h_usdc_base_units: bond,
          human_approval_policy: "out_of_policy",
        },
      }),
    });
    return {
      contract: candidate.source_id,
      title: candidate.title,
      publicUrl: candidate.public_url,
      solverRewardUsdcBaseUnits: candidate.reward?.amount ?? null,
      claimBondUsdcBaseUnits: bond ?? null,
      requiredExternalSpendUsdcBaseUnits:
        candidate.cash_economics?.required_external_spend?.amount ?? null,
      observedBlockNumber: readiness.observed_block_number,
      observedWorkerUsdcBaseUnits: readiness.observed_usdc_balance_base_units,
      recommendedClaimPath: readiness.recommended_claim_path,
      readyWithoutSponsorship: readiness.ready,
      failedChecks: (readiness.checks ?? [])
        .filter((check) => check.status !== "pass")
        .map((check) => check.name),
    };
  }),
);

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      workerAddress: wallet.address,
      projectionDegraded: opportunities?.degraded ?? null,
      inventorySummary: {
        claimableBountyCount: summary?.claimable_bounty_count ?? null,
        verificationReadyBountyCount:
          summary?.verification_ready_bounty_count ?? null,
        solverRewardUsdc: summary?.solver_reward_usdc ?? null,
      },
      zeroExternalSpendCandidates: reports,
      immediatelyClaimableWithoutUserFunds: reports.filter(
        (report) => report.readyWithoutSponsorship,
      ),
      note:
        "A claimable listing is not payment. A zero-balance worker may proceed only if capped sponsorship is separately confirmed; only canonical BountySettled proves earnings.",
    },
    null,
    2,
  ),
);
