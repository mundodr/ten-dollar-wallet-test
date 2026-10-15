import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

const side = 5;
const beacons = new Set([6, 8, 12, 16, 18]);
const corners = [0, 24, 4, 20];
const turnMs = 18_000;
const idleMs = 60 * 60_000;
const maxMatches = 200;
const boardSize = side * side;

const randomCode = () => randomBytes(4).toString("hex").toUpperCase();
const randomToken = () => randomBytes(24).toString("base64url");
const neighbors = (index) => {
  const row = Math.floor(index / side);
  const col = index % side;
  return [
    row > 0 ? index - side : null,
    row < side - 1 ? index + side : null,
    col > 0 ? index - 1 : null,
    col < side - 1 ? index + 1 : null,
  ].filter((value) => value !== null);
};
const error = (status, message) => Object.assign(new Error(message), { status });
const cleanName = (name) => {
  const result = String(name ?? "Player").trim().replace(/\s+/g, " ").slice(0, 24);
  return result || "Player";
};

export class GameStore {
  constructor({ now = () => Date.now(), rng = Math.random } = {}) {
    this.now = now;
    this.rng = rng;
    this.matches = new Map();
  }

  create({ seats = 2, name = "Player" } = {}) {
    if (!Number.isInteger(seats) || seats < 2 || seats > 4) {
      throw error(400, "seats must be an integer from 2 to 4");
    }
    this.cleanup();
    if (this.matches.size >= maxMatches) throw error(503, "match capacity reached");
    let code;
    do code = randomCode(); while (this.matches.has(code));
    const token = randomToken();
    const match = {
      code,
      seats,
      players: [{ name: cleanName(name), token, bot: false, sparks: 3 }],
      board: Array.from({ length: boardSize }, () => ({ owner: null, shield: 0 })),
      phase: "lobby",
      turn: 0,
      moves: 0,
      maxTurns: seats === 2 ? 24 : seats === 3 ? 30 : 32,
      version: 0,
      deadline: null,
      log: [],
      updatedAt: this.now(),
    };
    this.matches.set(code, match);
    return { code, token, seat: 0 };
  }

  get(code) {
    const match = this.matches.get(String(code).toUpperCase());
    if (!match) throw error(404, "match not found");
    match.updatedAt = this.now();
    this.advance(match);
    return match;
  }

  join(code, { name = "Player" } = {}) {
    const match = this.get(code);
    if (match.phase !== "lobby") throw error(409, "match already started");
    if (match.players.length >= match.seats) throw error(409, "lobby is full");
    const token = randomToken();
    const seat = match.players.length;
    match.players.push({ name: cleanName(name), token, bot: false, sparks: 3 });
    match.version += 1;
    return { code: match.code, token, seat };
  }

  start(code, token) {
    const match = this.get(code);
    if (match.phase !== "lobby") throw error(409, "match already started");
    if (match.players[0].token !== token) throw error(403, "only the host can start");
    while (match.players.length < match.seats) {
      match.players.push({ name: `Garden Bot ${match.players.length + 1}`, token: randomToken(), bot: true, sparks: 3 });
    }
    for (let seat = 0; seat < match.seats; seat += 1) {
      match.board[corners[seat]].owner = seat;
    }
    match.phase = "playing";
    match.players[0].sparks = Math.min(5, match.players[0].sparks + 1);
    match.deadline = this.now() + turnMs;
    match.version += 1;
    match.log.push({ move: 0, type: "start", at: this.now(), players: match.players.map((p) => p.name) });
    this.advance(match);
    return this.snapshot(match, token);
  }

  legalMoves(match, seat) {
    if (match.phase !== "playing" || match.turn !== seat) return [];
    const player = match.players[seat];
    const legal = [{ action: "recharge" }];
    for (let index = 0; index < boardSize; index += 1) {
      const tile = match.board[index];
      const adjacent = neighbors(index);
      const support = adjacent.filter((n) => match.board[n].owner === seat).length;
      if (tile.owner === null && support > 0 && player.sparks >= 2) {
        legal.push({ action: "plant", target: index });
      } else if (tile.owner === seat && tile.shield === 0 && player.sparks >= 1) {
        legal.push({ action: "shield", target: index });
      } else if (tile.owner !== null && tile.owner !== seat && support > 0 && player.sparks >= 2 &&
        match.board.filter((other) => other.owner === tile.owner).length > 1) {
        const defense = 1 + tile.shield + adjacent.filter((n) => match.board[n].owner === tile.owner).length;
        if (support + 1 >= defense) legal.push({ action: "raid", target: index });
      }
    }
    return legal;
  }

  score(match) {
    return match.players.map((player, seat) => ({
      seat,
      name: player.name,
      points: match.board.reduce((total, tile, index) =>
        total + (tile.owner === seat ? (beacons.has(index) ? 3 : 1) + tile.shield : 0), 0),
      sparks: player.sparks,
    }));
  }

  chooseBotMove(match, seat) {
    const legal = this.legalMoves(match, seat);
    const ranked = legal.map((move) => {
      if (move.action === "raid") return { move, weight: 6 + (beacons.has(move.target) ? 5 : 0) };
      if (move.action === "plant") {
        const nearbyBeacon = neighbors(move.target).some((n) => beacons.has(n) && match.board[n].owner === null);
        return { move, weight: 5 + (beacons.has(move.target) ? 5 : 0) + (nearbyBeacon ? 2 : 0) };
      }
      if (move.action === "shield") return { move, weight: 2 + (beacons.has(move.target) ? 2 : 0) };
      return { move, weight: match.players[seat].sparks <= 2 ? 7 : 1 };
    });
    ranked.sort((a, b) => b.weight - a.weight || this.rng() - 0.5);
    return ranked[0].move;
  }

  apply(match, seat, move, reason = "player") {
    const legal = this.legalMoves(match, seat);
    const target = move.target === undefined ? undefined : Number(move.target);
    const accepted = legal.find((entry) => entry.action === move.action && entry.target === target);
    if (!accepted) throw error(422, "illegal move; request a fresh snapshot for legalMoves");
    const player = match.players[seat];
    if (move.action === "recharge") player.sparks = Math.min(5, player.sparks + 2);
    if (move.action === "plant" || move.action === "raid") {
      player.sparks -= 2;
      match.board[target] = { owner: seat, shield: 0 };
    }
    if (move.action === "shield") {
      player.sparks -= 1;
      match.board[target].shield = 1;
    }
    match.moves += 1;
    match.version += 1;
    match.log.push({ move: match.moves, seat, player: player.name, action: move.action, target: target ?? null, reason, at: this.now() });
    const oldDeadline = match.deadline;
    if (match.moves >= match.maxTurns) {
      match.phase = "finished";
      match.deadline = null;
      const standings = this.score(match).sort((a, b) => b.points - a.points || b.sparks - a.sparks);
      match.winners = standings.filter((row) => row.points === standings[0].points && row.sparks === standings[0].sparks).map((row) => row.seat);
      match.log.push({ move: match.moves, type: "finish", winners: match.winners, scores: this.score(match), at: this.now() });
    } else {
      match.turn = (match.turn + 1) % match.seats;
      match.players[match.turn].sparks = Math.min(5, match.players[match.turn].sparks + 1);
      match.deadline = reason === "timeout" || (reason === "bot" && oldDeadline < this.now())
        ? oldDeadline + turnMs
        : this.now() + turnMs;
    }
  }

  advance(match) {
    let guard = 0;
    while (match.phase === "playing" && guard < match.maxTurns) {
      const current = match.players[match.turn];
      if (current.bot) this.apply(match, match.turn, this.chooseBotMove(match, match.turn), "bot");
      else if (this.now() >= match.deadline) this.apply(match, match.turn, { action: "recharge" }, "timeout");
      else break;
      guard += 1;
    }
  }

  move(code, { token, action, target, expectedVersion } = {}) {
    const match = this.get(code);
    if (match.phase !== "playing") throw error(409, "match is not playing");
    const seat = match.players.findIndex((player) => !player.bot && player.token === token);
    if (seat < 0) throw error(403, "invalid seat token");
    if (seat !== match.turn) throw error(409, "not your turn");
    if (expectedVersion !== undefined && expectedVersion !== match.version) throw error(409, "stale match version");
    this.apply(match, seat, { action, target });
    this.advance(match);
    return this.snapshot(match, token);
  }

  snapshot(match, token) {
    const seat = match.players.findIndex((player) => !player.bot && player.token === token);
    return {
      code: match.code,
      phase: match.phase,
      seats: match.seats,
      players: match.players.map((player, index) => ({ seat: index, name: player.name, bot: player.bot, sparks: player.sparks })),
      board: match.board.map((tile, index) => ({ ...tile, beacon: beacons.has(index) })),
      turn: match.turn,
      moves: match.moves,
      maxTurns: match.maxTurns,
      version: match.version,
      deadline: match.deadline,
      scores: this.score(match),
      winners: match.winners ?? [],
      yourSeat: seat < 0 ? null : seat,
      legalMoves: seat < 0 ? [] : this.legalMoves(match, seat),
      log: match.log.slice(-40),
    };
  }

  cleanup() {
    const before = this.now() - idleMs;
    for (const [code, match] of this.matches) if (match.updatedAt < before) this.matches.delete(code);
  }
}

const json = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
};
const readBody = async (request) => {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 4096) throw error(413, "request body too large");
  }
  try { return text ? JSON.parse(text) : {}; }
  catch { throw error(400, "invalid JSON"); }
};

export function createGameHandler(store = new GameStore()) {
  return async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const pathname = url.pathname;
    if (pathname === "/signal-garden" || pathname === "/signal-garden/") {
      if (request.method !== "GET") return json(response, 405, { error: "method not allowed" });
      const html = await readFile(new URL("./index.html", import.meta.url));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'" });
      response.end(html);
      return true;
    }
    if (pathname === "/signal-garden/client.js") {
      if (request.method !== "GET") return json(response, 405, { error: "method not allowed" });
      const source = await readFile(new URL("./client.js", import.meta.url));
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      response.end(source);
      return true;
    }
    if (!pathname.startsWith("/signal-garden/api/")) return false;
    try {
      const parts = pathname.slice("/signal-garden/api/".length).split("/");
      if (request.method === "POST" && parts.length === 1 && parts[0] === "matches") {
        return json(response, 201, store.create(await readBody(request)));
      }
      if (parts[0] !== "matches" || parts.length < 2 || !/^[A-F0-9]{8}$/i.test(parts[1])) throw error(404, "route not found");
      const code = parts[1];
      if (request.method === "GET" && parts.length === 2) return json(response, 200, store.snapshot(store.get(code), url.searchParams.get("token")));
      if (request.method === "GET" && parts[2] === "replay") {
        const match = store.get(code);
        return json(response, 200, { code: match.code, phase: match.phase, log: match.log, scores: store.score(match), winners: match.winners ?? [] });
      }
      if (request.method === "POST" && parts[2] === "join") return json(response, 201, store.join(code, await readBody(request)));
      if (request.method === "POST" && parts[2] === "start") {
        const body = await readBody(request);
        return json(response, 200, store.start(code, body.token));
      }
      if (request.method === "POST" && parts[2] === "moves") return json(response, 200, store.move(code, await readBody(request)));
      throw error(404, "route not found");
    } catch (cause) {
      return json(response, cause.status ?? 500, { error: cause.status ? cause.message : "server error" });
    }
  };
}
