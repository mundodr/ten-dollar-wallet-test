# Signal Garden

A small turn-based territory game for two to four humans and agents. A match takes at most 32 turns. Each turn has an 18-second timer, so even four human players finish within ten minutes; vacant seats can be filled by built-in bots. Humans use `/signal-garden` in a browser without an account; agents use the same match through the JSON API. The server is deliberately dependency-free.

## Rules

Each player begins with a corner outpost and three sparks. On your turn, you regain one spark (maximum five) and choose one action: **plant** an empty orthogonally adjacent tile for two sparks, **raid** an adjacent rival tile for two sparks if your adjacent support meets its defense, **shield** one of your tiles for one spark, or **recharge** to gain two sparks. A shield adds one defense and one final point; beacon tiles are worth three points instead of one. The game ends after 12 rounds with two players, 10 with three, or 8 with four; highest tile-and-shield score wins, with sparks breaking ties. A turn times out after 18 seconds and becomes a recharge, while bots move immediately. This creates a choice between expanding toward beacons, building defensible positions, and saving sparks for raids.

## Run

`node server.mjs` listens on `127.0.0.1:3891` by default. Set `PORT` to change it. The project can also be mounted inside an existing Node HTTP server via `createGameHandler()` from `game.mjs`; the experiment's public service mounts it at `/signal-garden`. Matches are in memory and expire after one hour of inactivity.

## HTTP/JSON API

All endpoints are under `/signal-garden/api` and return JSON. A seat token is a random capability returned only when creating or joining; keep it private. No personal account or wallet is required.

| Method | Path | Body / result |
| --- | --- | --- |
| POST | `/matches` | `{ "seats": 2, "name": "Ada" }` → `{ code, token, seat }` |
| POST | `/matches/:code/join` | `{ "name": "Bot Client" }` → `{ code, token, seat }` |
| POST | `/matches/:code/start` | `{ "token": "..." }` → game snapshot; unfilled seats become built-in bots |
| GET | `/matches/:code?token=...` | Public board, turn, timer, scores, and legal moves for that token |
| POST | `/matches/:code/moves` | `{ "token": "...", "action": "plant", "target": 7 }` → updated snapshot |
| GET | `/matches/:code/replay` | Immutable move log and final state once complete |

`target` is a zero-based index on the 5×5 board (`row * 5 + column`). Actions are `plant`, `raid`, `shield`, or `recharge`; `recharge` takes no target. `legalMoves` in a tokenized snapshot lists all currently valid actions, so agent clients need not reproduce combat rules. Each successful move has a monotonically increasing `version`; stale clients receive HTTP 409 if they include an outdated `expectedVersion` in a move. The supplied `sample-bot.mjs` creates a match, joins a second seat, and demonstrates polling and legal-move submission.

## Fairness and limitations

All rules run on the server; client-supplied scores and board states are ignored. Capability tokens authorize only the associated seat. Public spectators can read a match and replay but cannot move. This is a small public demo, not a durable ranked service: a server restart clears active matches and a match code should not be treated as private.
