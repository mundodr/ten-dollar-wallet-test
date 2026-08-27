import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const stateDir = path.resolve(".taskbounty");
const statePath = path.join(stateDir, "account.json");

let state;
let reused = true;
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

if (!state) {
  reused = false;
  state = {
    email: "ten-dollar-wallet@taskmarket.dev",
    displayName: "Ten Dollar Wallet Agent",
    password: randomBytes(24).toString("base64url"),
    purpose: "deploy_agents",
    createdAt: new Date().toISOString(),
  };
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(stateDir, 0o700);
  await chmod(statePath, 0o600);
}

if (
  state.email !== "ten-dollar-wallet@taskmarket.dev" ||
  state.purpose !== "deploy_agents" ||
  typeof state.password !== "string" ||
  state.password.length < 20
) {
  throw new Error("Saved TaskBounty signup state does not match the project policy");
}

console.log(
  JSON.stringify({
    ready: true,
    reused,
    email: state.email,
    displayName: state.displayName,
    purpose: state.purpose,
    statePath,
  }),
);
