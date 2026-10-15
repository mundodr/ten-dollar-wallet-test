import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { GameStore, createGameHandler } from "../deliverables/taskmarket/TSK-V6J8MSSD/game.mjs";

test("lobby, bot fill, legal moves, and turn rotation", () => {
  let now = 1_000;
  const store = new GameStore({ now: () => now, rng: () => 0.5 });
  const host = store.create({ seats: 3, name: "Ada" });
  const guest = store.join(host.code, { name: "Bea" });
  assert.notEqual(host.token, guest.token);
  const start = store.start(host.code, host.token);
  assert.equal(start.players.length, 3);
  assert.equal(start.players[2].bot, true);
  assert.equal(start.legalMoves.some((move) => move.action === "plant"), true);
  assert.equal(start.yourSeat, 0);
  assert.equal(store.snapshot(store.get(host.code), guest.token).yourSeat, 1);
  assert.equal(store.snapshot(store.get(host.code), "wrong").legalMoves.length, 0);
  const plant = start.legalMoves.find((move) => move.action === "plant");
  const next = store.move(host.code, { token: host.token, ...plant, expectedVersion: start.version });
  assert.equal(next.board[plant.target].owner, 0);
  assert.equal(next.turn, 1);
  assert.equal(next.log.at(-1).action, "plant");
  assert.throws(() => store.move(host.code, { token: host.token, action: "recharge" }), /not your turn/);
  now += 18_001;
  const afterTimeout = store.snapshot(store.get(host.code), host.token);
  assert.equal(afterTimeout.log.some((entry) => entry.reason === "timeout"), true);
  assert.equal(afterTimeout.turn, 0);
});

test("no arbitrary board edits or stale/replayed moves", () => {
  const store = new GameStore();
  const host = store.create({ seats: 2 });
  store.start(host.code, host.token);
  const state = store.snapshot(store.get(host.code), host.token);
  assert.throws(() => store.move(host.code, { token: host.token, action: "raid", target: 24 }), /illegal move/);
  assert.throws(() => store.move(host.code, { token: "wrong", action: "recharge" }), /invalid seat token/);
  assert.throws(() => store.move(host.code, { token: host.token, action: "recharge", expectedVersion: -1 }), /stale match version/);
  const next = store.move(host.code, { token: host.token, action: "recharge", expectedVersion: state.version });
  assert.equal(next.players[0].sparks, 5);
  assert.equal(next.moves, 2); // the built-in bot immediately plays the next turn
});

test("match finishes after bounded turns and replay stays readable", () => {
  const store = new GameStore({ rng: () => 0.5 });
  const host = store.create({ seats: 4 });
  store.start(host.code, host.token);
  for (let guard = 0; guard < 40; guard += 1) {
    const match = store.get(host.code);
    if (match.phase === "finished") break;
    const legal = store.legalMoves(match, 0);
    store.move(host.code, { token: host.token, ...legal.find((move) => move.action === "plant") ?? legal[0] });
  }
  const final = store.snapshot(store.get(host.code), host.token);
  assert.equal(final.phase, "finished");
  assert.equal(final.moves, 32);
  assert.equal(final.winners.length >= 1, true);
  assert.equal(final.log.at(-1).type, "finish");
});

test("browser and agent HTTP paths share a real match", async () => {
  const handle = createGameHandler();
  const server = createServer((request, response) => handle(request, response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${origin}/signal-garden`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Signal Garden/);
    const asset = await fetch(`${origin}/signal-garden/client.js`);
    assert.equal(asset.status, 200);
    const request = async (path, body) => {
      const response = await fetch(`${origin}/signal-garden/api/matches${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    const created = await request("", { seats: 2, name: "Human" });
    assert.equal(created.status, 201);
    const joined = await request(`/${created.body.code}/join`, { name: "Agent" });
    assert.equal(joined.status, 201);
    const started = await request(`/${created.body.code}/start`, { token: created.body.token });
    assert.equal(started.body.phase, "playing");
    const agent = await fetch(`${origin}/signal-garden/api/matches/${created.body.code}?token=${joined.body.token}`);
    assert.equal((await agent.json()).yourSeat, 1);
    const move = started.body.legalMoves.find((item) => item.action === "plant");
    const moved = await request(`/${created.body.code}/moves`, { token: created.body.token, ...move, expectedVersion: started.body.version });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.board[move.target].owner, 0);
    const replay = await fetch(`${origin}/signal-garden/api/matches/${created.body.code}/replay`);
    assert.equal((await replay.json()).log.at(-1).action, "plant");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
