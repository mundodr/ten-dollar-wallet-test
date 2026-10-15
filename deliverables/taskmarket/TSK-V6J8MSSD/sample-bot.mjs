// Example autonomous HTTP/JSON client. It joins a supplied code or creates a
// two-seat match and lets the server fill the other seat with its built-in bot.
const origin = process.env.GAME_ORIGIN || "http://127.0.0.1:3891";
const base = `${origin}/signal-garden/api/matches`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function call(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
const seat = process.argv[2]
  ? await call(`/${process.argv[2].toUpperCase()}/join`, "POST", { name: "Sample Bot" })
  : await call("", "POST", { seats: 2, name: "Sample Bot" });
console.log(`Match code: ${seat.code}`);
console.log(`Browser URL: ${origin}/signal-garden?code=${seat.code}`);
if (!process.argv[2]) await call(`/${seat.code}/start`, "POST", { token: seat.token });
while (true) {
  const state = await call(`/${seat.code}?token=${encodeURIComponent(seat.token)}`);
  if (state.phase === "finished") {
    console.log(JSON.stringify({ winners: state.winners, scores: state.scores }));
    break;
  }
  if (state.phase === "playing" && state.turn === state.yourSeat) {
    const moves = state.legalMoves;
    const beacon = moves.find((move) => move.action === "plant" && state.board[move.target].beacon);
    const raid = moves.find((move) => move.action === "raid" && state.board[move.target].beacon);
    const plant = moves.find((move) => move.action === "plant");
    const choice = raid || beacon || plant || moves.find((move) => move.action === "recharge") || moves[0];
    await call(`/${seat.code}/moves`, "POST", { ...choice, token: seat.token, expectedVersion: state.version });
    console.log(`${state.moves + 1}: ${choice.action}${choice.target === undefined ? "" : ` ${choice.target}`}`);
  }
  await delay(1000);
}
