import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://www.agenthansa.com";
const credentials = JSON.parse(
  await readFile(path.resolve(".agenthansa/credentials.json"), "utf8"),
);
const statePath = path.resolve(".agenthansa/arena-state.json");
const supportedStrategies = new Map([
  ["coin_snipe", "random_pick"],
  ["crash_pilot", "safe_exit"],
]);

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
          ...(options.body ? { "Content-Type": "application/json" } : {}),
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
  if (!response.ok && response.status !== 409) {
    throw new Error(`${route} failed (${response.status}): ${body?.detail ?? body?.message}`);
  }
  return { status: response.status, body };
}

const { body: upcomingList } = await request("/api/arena/tournaments?status=upcoming");
const upcoming = (upcomingList?.items ?? [])
  .filter((tournament) => tournament.status === "upcoming")
  .filter((tournament) => supportedStrategies.has(tournament.game?.key))
  .filter((tournament) => Number(tournament.pot_amount ?? 0) === 0)
  .sort((left, right) => new Date(left.scheduled_at) - new Date(right.scheduled_at))[0];
if (!upcoming) {
  console.log(JSON.stringify({ status: "no_supported_free_tournament" }, null, 2));
  process.exit(0);
}
if (Number(upcoming.pot_amount ?? 0) !== 0) {
  throw new Error("Refusing an arena tournament with a non-zero participant pot");
}

const gameKey = upcoming.game.key;
const selectedStrategy = supportedStrategies.get(gameKey);
const { body: strategy } = await request("/api/arena/strategy", {
  method: "PUT",
  body: JSON.stringify({ game_key: gameKey, strategy: selectedStrategy, params: {} }),
});
const joined = await request(`/api/arena/tournaments/${upcoming.id}/participants`, {
  method: "POST",
});
const { body: participants } = await request(
  `/api/arena/tournaments/${upcoming.id}/participants`,
);
const ownParticipant = (participants?.items ?? participants ?? []).find(
  (participant) =>
    participant.agent_id === credentials.agentId || participant.agent?.id === credentials.agentId,
);

const state = {
  tournamentId: upcoming.id,
  game: gameKey,
  scheduledAt: upcoming.scheduled_at,
  strategy: strategy?.strategy ?? selectedStrategy,
  joinedStatus: joined.status,
  participantConfirmed: Boolean(ownParticipant) || joined.status === 201 || joined.status === 409,
  updatedAt: new Date().toISOString(),
};
await mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
await chmod(statePath, 0o600);

console.log(JSON.stringify(state, null, 2));
