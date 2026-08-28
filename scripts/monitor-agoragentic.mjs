import { readFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://agoragentic.com/api";
const targetWallet = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const serviceName = "Deterministic API Acceptance Checklist";
const credentials = JSON.parse(
  await readFile(path.resolve(".agoragentic/credentials.json"), "utf8"),
);
const service = JSON.parse(
  await readFile(path.resolve(".agoragentic/service.json"), "utf8"),
);

async function request(pathname, authenticated = true) {
  const response = await fetch(`${apiBase}${pathname}`, {
    headers: {
      Accept: "application/json",
      ...(authenticated
        ? { Authorization: `Bearer ${credentials.apiKey}` }
        : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Agoragentic ${pathname} failed (${response.status})`);
  }
  return body;
}

if (
  credentials.targetWallet?.toLowerCase() !== targetWallet ||
  service.targetWallet?.toLowerCase() !== targetWallet
) {
  throw new Error("Agoragentic forwarding target does not match the approved Base address");
}

const [profile, status, health, activity, wallet, relayBody, listing, platformHealth] =
  await Promise.all([
    request("/agents/me"),
    request("/seller/status"),
    request("/seller/health"),
    request("/seller/activity"),
    request("/wallet"),
    request("/relay"),
    request(`/capabilities/${encodeURIComponent(service.listingId)}`),
    request("/health", false),
  ]);

const relay = (relayBody.functions ?? relayBody.relays ?? relayBody.items ?? []).find(
  (item) => item.name === serviceName,
);
const internalBalance = Number(
  wallet.balance ?? wallet.balance_usdc ?? profile.wallet?.balance ?? 0,
);
const withdrawable = Number(
  wallet.withdrawable ?? wallet.withdrawable_usdc ?? profile.wallet?.withdrawable ?? 0,
);

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agentId: credentials.agentId,
      agentActive: profile.agent?.status === "active",
      targetWallet,
      exactForwardingTarget: credentials.targetWallet.toLowerCase() === targetWallet,
      listing: listing
        ? {
            id: listing.id,
            status: listing.status,
            reviewStatus: listing.review_status,
            verificationStatus: listing.verification_status,
            invokable: listing.invokable,
            priceUsdc: listing.price_per_unit,
            totalInvocations: listing.total_invocations,
            paidSuccessCount: Number(listing.paid_success_count ?? 0),
            operationalStatus:
              listing.operational_availability?.status ??
              listing.commerce_contract?.operational_status ??
              null,
            operationalReason:
              listing.operational_availability?.reason ??
              listing.commerce_contract?.reason ??
              null,
            paidExecutionEnabled:
              listing.operational_availability?.paid_execution_enabled ?? null,
          }
        : null,
      relay: relay
        ? {
            id: relay.id ?? relay.function_id,
            status: relay.status,
            totalExecutions:
              relay.runtime_total_executions ?? relay.total_executions ?? 0,
          }
        : null,
      internalBalanceUsdc: internalBalance,
      withdrawableUsdc: withdrawable,
      payoutMinimumUsdc: 1,
      payoutReady: withdrawable >= 1,
      platformOutboundStatus:
        platformHealth.checks?.platform_outbound_signer?.status ?? null,
      sellerStatus: {
        livePaidListings: status.seller?.live_paid_listings ?? 0,
        stakeDueForNextListingUsdc:
          status.seller?.stake_amount_due_now_usdc ?? 0,
      },
      sellerHealth: health.summary ?? health.status ?? null,
      recentActivity: activity.activities ?? activity.items ?? [],
      nextAction:
        withdrawable >= 1
          ? "Withdraw the full earned balance through the official path to the exact Base target, then independently verify the receipt."
          : listing?.operational_availability?.paid_execution_enabled === false
            ? "Keep the approved listing live and monitor platform custody recovery before accepting paid traffic as possible."
          : "Keep the verified listing live and monitor genuine paid calls.",
      countingPolicy:
        "Registration, listings, calls, receipts, and internal balances do not count; only a matching Base-mainnet target transfer counts.",
    },
    null,
    2,
  ),
);
