#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("deliverables/taskmarket/TSK-E4RXQS7X/death-gym");
const logFile = path.join(root, "local/logs/long-5b.log");
const checkpointDir = path.join(root, "local/checkpoints/long-5b");
const evaluationsDir = path.join(root, "local/evaluations");
const serviceName = "deathgym-taskmarket-5b.service";
const targetSteps = 5_000_000_000;
const taskExpiry = "2026-08-29T21:40:19.006Z";

function serviceProperties() {
  try {
    const output = execFileSync(
      "systemctl",
      ["--user", "show", serviceName, "-p", "ActiveState", "-p", "SubState", "-p", "MainPID", "-p", "ExecMainStatus", "-p", "ExecMainStartTimestamp"],
      { encoding: "utf8" },
    );
    return Object.fromEntries(
      output.trim().split("\n").filter(Boolean).map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
    );
  } catch (error) {
    return { ActiveState: "unknown", error: error.message };
  }
}

async function filesIn(directory, suffix) {
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith(suffix)).sort();
    return Promise.all(names.map(async (name) => {
      const info = await stat(path.join(directory, name));
      return { name, sizeBytes: info.size, modifiedAt: info.mtime.toISOString() };
    }));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

let log = "";
try {
  log = await readFile(logFile, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const lines = log.trim().split("\n");
const progressLines = lines.filter((line) => /^it\s+\d+\/\d+/.test(line.trim()));
const latestLine = progressLines.at(-1) ?? null;
const match = latestLine?.match(/it\s+(\d+)\/(\d+).*?fps:\s*(\d+).*?death_xp:\s*(\d+)/);
const currentIteration = match ? Number(match[1]) : 0;
const totalIterations = match ? Number(match[2]) : 76_293;
const fps = match ? Number(match[3]) : null;
const completedSteps = Math.min(targetSteps, currentIteration * 65_536);
const remainingSeconds = fps ? Math.max(0, targetSteps - completedSteps) / fps : null;

const evaluationFiles = await filesIn(evaluationsDir, ".json");
const evaluations = [];
for (const file of evaluationFiles) {
  try {
    evaluations.push(JSON.parse(await readFile(path.join(evaluationsDir, file.name), "utf8")));
  } catch {
    evaluations.push({ file: file.name, parseError: true });
  }
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  service: serviceProperties(),
  progress: {
    currentIteration,
    totalIterations,
    completedSteps,
    targetSteps,
    percent: Number(((completedSteps / targetSteps) * 100).toFixed(4)),
    fps,
    latestLine,
    estimatedRemainingHours: remainingSeconds === null ? null : Number((remainingSeconds / 3600).toFixed(2)),
    estimatedFinishAt: remainingSeconds === null ? null : new Date(Date.now() + remainingSeconds * 1000).toISOString(),
  },
  task: {
    referenceCode: "TSK-E4RXQS7X",
    netPrizeUsdc: 92.5,
    expiryTime: taskExpiry,
    hoursUntilExpiry: Number(((new Date(taskExpiry).getTime() - Date.now()) / 3_600_000).toFixed(2)),
    currentPublicLeaderXp: 341.1,
    baseline20mPublicXp: 179.5,
  },
  checkpoints: await filesIn(checkpointDir, ".safetensors"),
  evaluations,
  countingPolicy: "Training and submissions do not count unless the benchmark is awarded, withdrawn, and transferred to the approved Base target.",
}, null, 2));
