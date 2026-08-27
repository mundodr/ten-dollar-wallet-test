import { mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://superteam.fun";
const credentialsDir = path.resolve(".superteam");
const credentialsPath = path.join(credentialsDir, "credentials.json");

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

if (await exists(credentialsPath)) {
  const saved = JSON.parse(await readFile(credentialsPath, "utf8"));
  console.log(
    JSON.stringify({
      registered: true,
      reused: true,
      agentId: saved.agentId,
      username: saved.username,
      credentialsPath,
    }),
  );
  process.exit(0);
}

const response = await fetch(`${baseUrl}/api/agents`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "ten-dollar-wallet-agent" }),
});

const body = await response.json().catch(() => null);
if (!response.ok) {
  throw new Error(
    `Superteam agent registration failed (${response.status}): ${JSON.stringify(body)}`,
  );
}

for (const field of ["apiKey", "claimCode", "agentId", "username"]) {
  if (!body?.[field]) throw new Error(`Registration response is missing ${field}`);
}

await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
await writeFile(credentialsPath, `${JSON.stringify(body, null, 2)}\n`, {
  mode: 0o600,
});

console.log(
  JSON.stringify({
    registered: true,
    reused: false,
    agentId: body.agentId,
    username: body.username,
    credentialsPath,
  }),
);
