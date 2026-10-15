const base = "/signal-garden/api/matches";
const el = (id) => document.getElementById(id);
const names = ["Teal", "Orchid", "Amber", "Slate"];
let code = null;
let token = null;
let selectedAction = "plant";
let snapshot = null;
let busy = false;

function message(text) { el("toast").textContent = text; }
async function api(path, method = "GET", data) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: data ? { "content-type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
function persist() {
  sessionStorage.setItem("signal-garden-seat", JSON.stringify({ code, token }));
  history.replaceState(null, "", `/signal-garden?code=${encodeURIComponent(code)}`);
}
function joinWith(result) {
  code = result.code;
  token = result.token;
  persist();
  el("setup").classList.add("hidden");
  el("game").classList.remove("hidden");
  el("code-pill").textContent = code;
  el("replay").href = `${base}/${code}/replay`;
  refresh();
}
function render() {
  if (!snapshot) return;
  const state = snapshot;
  el("start").classList.toggle("hidden", state.phase !== "lobby" || state.yourSeat !== 0);
  el("controls").classList.toggle("hidden", state.phase !== "playing");
  const current = state.players[state.turn];
  const remaining = state.deadline ? Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)) : null;
  el("status").textContent = state.phase === "lobby"
    ? `Waiting for players · ${state.players.length}/${state.seats}`
    : state.phase === "finished"
      ? `Finished · ${state.winners.map((seat) => state.players[seat].name).join(" + ")} wins!`
      : `${current.name}'s turn · ${remaining}s left`;
  el("hint").textContent = state.phase === "playing"
    ? `${state.moves}/${state.maxTurns} turns played · ${state.yourSeat === state.turn ? "Your move!" : "Watching and waiting…"}`
    : state.phase === "lobby" ? "The host can start now; vacant seats become bots." : "Open replay JSON to inspect every move.";
  const scoreBox = el("scores");
  scoreBox.replaceChildren();
  for (const row of state.scores) {
    const div = document.createElement("div");
    div.className = `score${state.phase === "playing" && row.seat === state.turn ? " current" : ""}`;
    const left = document.createElement("span");
    left.textContent = `${names[row.seat]} · ${row.name}${state.players[row.seat].bot ? " 🤖" : ""}${state.yourSeat === row.seat ? " (you)" : ""}`;
    const right = document.createElement("strong");
    right.textContent = `${row.points} pts · ${row.sparks} ✦`;
    div.append(left, right);
    scoreBox.append(div);
  }
  const board = el("board");
  board.replaceChildren();
  state.board.forEach((tile, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile";
    btn.dataset.owner = tile.owner === null ? "none" : String(tile.owner);
    const legal = state.legalMoves.some((move) => move.action === selectedAction && move.target === index);
    if (legal) btn.classList.add("legal");
    btn.disabled = !legal;
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = tile.owner === null ? "·" : ["◆", "●", "▲", "■"][tile.owner];
    btn.append(mark);
    if (tile.beacon) {
      const star = document.createElement("span");
      star.className = "beacon";
      star.textContent = "★";
      btn.append(star);
    }
    if (tile.shield) {
      const shield = document.createElement("span");
      shield.className = "shield";
      shield.textContent = "🛡";
      btn.append(shield);
    }
    btn.setAttribute("aria-label", `Row ${Math.floor(index / 5) + 1}, column ${index % 5 + 1}, ${tile.owner === null ? "empty" : names[tile.owner]}, ${tile.beacon ? "beacon" : "ordinary"}${tile.shield ? ", shielded" : ""}`);
    btn.addEventListener("click", () => submit(selectedAction, index));
    board.append(btn);
  });
  const log = el("log");
  log.replaceChildren();
  for (const entry of [...state.log].reverse()) {
    const div = document.createElement("div");
    div.textContent = entry.type === "start" ? "The garden opened." : entry.type === "finish" ? "The match has ended." : `#${entry.move} ${entry.player}: ${entry.action}${entry.target === null ? "" : ` on ${Math.floor(entry.target / 5) + 1},${entry.target % 5 + 1}`}${entry.reason === "timeout" ? " (timer)" : ""}`;
    log.append(div);
  }
}
async function refresh() {
  if (!code || busy) return;
  try { snapshot = await api(`/${code}?token=${encodeURIComponent(token)}`); render(); }
  catch (err) { message(err.message); }
}
async function submit(action, target) {
  if (busy || !snapshot) return;
  busy = true;
  try {
    snapshot = await api(`/${code}/moves`, "POST", { token, action, target, expectedVersion: snapshot.version });
    render();
    message("");
  } catch (err) { message(err.message); await refresh(); }
  finally { busy = false; }
}
el("create").addEventListener("click", async () => {
  try { joinWith(await api("", "POST", { seats: Number(el("seats").value), name: el("name").value })); message("Share your code, then start when ready."); }
  catch (err) { message(err.message); }
});
el("join").addEventListener("click", async () => {
  try { joinWith(await api(`/${el("join-code").value.trim().toUpperCase()}/join`, "POST", { name: el("name").value })); message("You joined the garden."); }
  catch (err) { message(err.message); }
});
el("start").addEventListener("click", async () => {
  try { snapshot = await api(`/${code}/start`, "POST", { token }); render(); message("Match started."); }
  catch (err) { message(err.message); }
});
el("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(`${location.origin}/signal-garden?code=${code}`); message("Invite link copied."); }
  catch { message(`Share this code: ${code}`); }
});
for (const button of el("controls").querySelectorAll("button")) button.addEventListener("click", () => {
  selectedAction = button.dataset.action;
  for (const item of el("controls").querySelectorAll("button")) item.classList.toggle("selected", item === button);
  if (selectedAction === "recharge") submit("recharge");
  else render();
});
const saved = JSON.parse(sessionStorage.getItem("signal-garden-seat") || "null");
if (saved?.code && saved?.token) joinWith(saved);
else if (new URLSearchParams(location.search).has("code")) el("join-code").value = new URLSearchParams(location.search).get("code").toUpperCase();
setInterval(refresh, 1100);
setInterval(() => { if (snapshot?.phase === "playing") render(); }, 500);
