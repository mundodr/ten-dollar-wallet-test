import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://www.agenthansa.com";
const targetWallet = "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt";
const credentials = JSON.parse(
  await readFile(path.resolve(".agenthansa/credentials.json"), "utf8"),
);
const arenaState = JSON.parse(
  await readFile(path.resolve(".agenthansa/arena-state.json"), "utf8"),
);

async function request(route, options = {}) {
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(`${baseUrl}${route}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          Accept: "application/json",
          ...options.headers,
        },
      });
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  if (!response) throw lastError ?? new Error(`No response for ${route}`);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${route} failed (${response.status}): ${body?.detail ?? body?.message}`);
  }
  return body;
}

const tournamentId = arenaState.tournamentId;
const [tournament, rounds, leaderboard, profile, initialEarnings, initialTransfers] =
  await Promise.all([
    request(`/api/arena/tournaments/${tournamentId}`),
    request(`/api/arena/tournaments/${tournamentId}/rounds`),
    request(`/api/arena/tournaments/${tournamentId}/leaderboard`),
    request("/api/agents/me"),
    request("/api/agents/earnings"),
    request("/api/agents/transfers"),
  ]);

const availableUsdc = Number(initialEarnings.available_usdc ?? 0);
const payoutThreshold = Number(initialEarnings.payout_threshold ?? 1);
let payoutRequest = null;
if (
  profile.wallet_address === targetWallet &&
  availableUsdc >= payoutThreshold &&
  payoutThreshold > 0
) {
  payoutRequest = await request("/api/agents/request-payout", { method: "POST" });
}

const earnings = payoutRequest
  ? await request("/api/agents/earnings")
  : initialEarnings;
const transfers = payoutRequest
  ? await request("/api/agents/transfers")
  : initialTransfers;

const ownRows = (rounds?.items ?? rounds ?? []).filter(
  (row) =>
    row.agent_id === credentials.agentId ||
    row.agent?.id === credentials.agentId ||
    row.agent_name === "ten-dollar-wallet-worker",
);
const placement = (tournament.placements ?? []).find(
  (row) => row.agent_id === credentials.agentId || row.agent?.id === credentials.agentId,
);

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      tournament: {
        id: tournament.id,
        game: tournament.game?.key,
        status: tournament.status,
        phase: tournament.phase,
        currentRound: tournament.current_round,
        participantCount: tournament.participant_count,
        potAmount: tournament.pot_amount,
        payoutStatus: tournament.payout_status,
        placement: placement ?? null,
      },
      leaderboard: {
        stats: leaderboard?.stats ?? null,
        ownEntry:
          (leaderboard?.items ?? []).find(
            (row) =>
              row.agent_id === credentials.agentId ||
              row.agent?.id === credentials.agentId ||
              row.agent_name === "ten-dollar-wallet-worker",
          ) ?? null,
      },
      ownRoundRows: ownRows,
      earnings: {
        pending: earnings.pending_earned,
        confirmed: earnings.confirmed_earned,
        paid: earnings.paid_earned,
        available: earnings.available_usdc,
        payoutThreshold: earnings.payout_threshold,
      },
      payoutRequested: Boolean(payoutRequest),
      payoutRequest,
      transfers,
    },
    null,
    2,
  ),
);
