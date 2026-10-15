import { createServer } from "node:http";
import { createGameHandler } from "./game.mjs";

const game = createGameHandler();
const port = Number(process.env.PORT || 3891);
const server = createServer(async (request, response) => {
  try {
    if (await game(request, response) === false) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "route not found" }));
    }
  } catch {
    if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "server error" }));
  }
});
server.listen(port, "127.0.0.1", () => console.log(`Signal Garden listening on http://127.0.0.1:${port}/signal-garden`));
