#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { ed25519 } from "@noble/curves/ed25519.js";

const API = "https://api.basedagents.ai";
const KEYPAIR_PATH = "/home/lenovo/.basedagents/keys/tendollarwalletworker-keypair.json";
const TARGET = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const NETWORK = "eip155:8453";

function hexToBytes(value) {
  if (!/^[a-fA-F0-9]+$/.test(value) || value.length % 2 !== 0) {
    throw new Error("Invalid hexadecimal key material");
  }
  return Uint8Array.from(Buffer.from(value, "hex"));
}

function base58Encode(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let zeros = 0;
  for (const byte of bytes) {
    if (byte !== 0) break;
    zeros += 1;
  }
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);
  let encoded = "";
  while (number > 0n) {
    encoded = alphabet[Number(number % 58n)] + encoded;
    number /= 58n;
  }
  return "1".repeat(zeros) + encoded;
}

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: "application/json", ...options.headers },
    ...options,
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text.slice(0, 2000) };
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  }
  return { payload, response };
}

async function loadIdentity() {
  const keyStat = await stat(KEYPAIR_PATH);
  if ((keyStat.mode & 0o077) !== 0) throw new Error("BasedAgents keypair permissions are broader than 0600");
  const saved = JSON.parse(await readFile(KEYPAIR_PATH, "utf8"));
  const publicKey = hexToBytes(saved.publicKey);
  const privateKey = hexToBytes(saved.privateKey);
  const publicKeyBase58 = base58Encode(publicKey);
  return { publicKey, privateKey, publicKeyBase58, agentId: `ag_${publicKeyBase58}` };
}

async function serverTimestamp() {
  const response = await fetch(`${API}/v1/status`, { method: "HEAD" });
  const date = response.headers.get("date");
  if (!date || Number.isNaN(Date.parse(date))) throw new Error("BasedAgents API did not return a usable Date header");
  return Math.floor(Date.parse(date) / 1000).toString();
}

async function signedHeaders(identity, method, path, body) {
  const timestamp = await serverTimestamp();
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const message = `${method}:${path}:${timestamp}:${bodyHash}:${nonce}`;
  const signature = ed25519.sign(Buffer.from(message), identity.privateKey);
  return {
    Authorization: `AgentSig ${identity.publicKeyBase58}:${Buffer.from(signature).toString("base64")}`,
    "X-Timestamp": timestamp,
    "X-Nonce": nonce,
    "Content-Type": "application/json",
  };
}

async function setWallet() {
  const identity = await loadIdentity();
  const path = `/v1/agents/${identity.agentId}/wallet`;
  const body = JSON.stringify({ wallet_address: TARGET, wallet_network: NETWORK });
  const headers = await signedHeaders(identity, "PATCH", path, body);
  const { payload } = await request(path, { method: "PATCH", headers, body });
  if (payload.agent_id !== identity.agentId) throw new Error("BasedAgents returned a different agent identity");
  if (payload.wallet_address?.toLowerCase() !== TARGET) throw new Error("BasedAgents returned a different payout wallet");
  if (payload.wallet_network !== NETWORK) throw new Error("BasedAgents returned a different payout network");
  console.log(JSON.stringify({ status: "wallet-configured", ...payload }, null, 2));
}

async function monitor() {
  const identity = await loadIdentity();
  const [{ payload: profile }, { payload: tasks }, { payload: wallet }] = await Promise.all([
    request(`/v1/agents/${identity.agentId}`),
    request("/v1/tasks?status=open&limit=100"),
    request(`/v1/agents/${identity.agentId}/wallet`),
  ]);
  if (profile.agent_id !== identity.agentId) throw new Error("BasedAgents public profile identity mismatch");
  const openTasks = Array.isArray(tasks.tasks) ? tasks.tasks : [];
  const fundedOpenTasks = openTasks.filter((task) => {
    const amount = Number.parseFloat(String(task.bounty_amount ?? "0").replace("$", ""));
    return amount > 0 && task.payment_verified === 1 && task.payment_status !== "none";
  });
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    agentId: identity.agentId,
    name: profile.name,
    status: profile.status,
    walletAddress: wallet.wallet_address,
    walletNetwork: wallet.wallet_network,
    exactTargetWallet: wallet.wallet_address?.toLowerCase() === TARGET,
    exactTargetNetwork: wallet.wallet_network === NETWORK,
    openTaskCount: openTasks.length,
    fundedOpenTaskCount: fundedOpenTasks.length,
    fundedOpenTasks,
    nextAction: fundedOpenTasks.length > 0
      ? "Review each funded task and claim only safe, no-deposit work with verifiable payment authorization."
      : "Keep monitoring the public task feed for verified Base-USDC work.",
    countingPolicy: "Registration, listings, claims, deliverables, and deferred authorizations are not funds; only a successful target-chain transfer counts.",
  }, null, 2));
}

if (process.argv[2] === "set-wallet") await setWallet();
else if (!process.argv[2] || process.argv[2] === "monitor") await monitor();
else throw new Error("Usage: node scripts/monitor-basedagents.mjs [monitor|set-wallet]");
