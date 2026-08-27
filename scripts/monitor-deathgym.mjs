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
const stepsPerIteration = 65_536;
const checkpointEverySteps = 250_000_000;
const minimumNextSubmissionXp = 266.5;
const taskExpiry = "2026-08-29T21:40:19.006Z";
const workerAddress = "0xbb8f5dA5e6E14BD221e720D8e1798Fb8A5c7EA71";
const leaderboardGistId = "545d0b413e31b315a017157339adca9e";
const leaderboardApi =
  `https://api.github.com/gists/${leaderboardGistId}`;

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

async function publicLeaderboard() {
  try {
    let gist;
    let source = "public_fetch";
    let publicFetchError = null;
    try {
      const response = await fetch(leaderboardApi, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "ten-dollar-wallet-deathgym-monitor/1.0",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`GitHub Gist returned ${response.status}`);
      gist = await response.json();
    } catch (error) {
      publicFetchError = error.message;
      source = "authenticated_gh_cli";
      gist = JSON.parse(
        execFileSync(
          "gh",
          [
            "api",
            `gists/${leaderboardGistId}`,
            "-H",
            "Accept: application/vnd.github+json",
          ],
          { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
        ),
      );
    }
    const content = gist.files?.["LEADERBOARD.md"]?.content ?? "";
    const rows = content
      .split("\n")
      .filter((line) => /^\|\s*\d+\s*\|/.test(line))
      .map((line) => {
        const parts = line.split("|").slice(1, -1).map((part) => part.trim());
        return {
          rank: Number(parts[0]),
          worker: parts[1]?.replaceAll("`", ""),
          meanXp: Number(parts[2]),
          submittedAt: parts[3],
          archiveSha256: parts[4]?.replaceAll("`", ""),
        };
      })
      .filter(
        (row) =>
          Number.isFinite(row.rank) &&
          Number.isFinite(row.meanXp) &&
          /^[0-9a-f]{64}$/i.test(row.archiveSha256 ?? ""),
      );
    const ownRows = rows.filter(
      (row) => row.worker?.toLowerCase() === workerAddress.toLowerCase(),
    );
    return {
      source,
      updatedAt: gist.updated_at ?? null,
      currentLeaderXp: rows[0]?.meanXp ?? null,
      ownRows,
      observedArchiveHashes: new Set(rows.map((row) => row.archiveSha256)),
      publicFetchError,
      error: null,
    };
  } catch (error) {
    return {
      source: null,
      updatedAt: null,
      currentLeaderXp: null,
      ownRows: [],
      observedArchiveHashes: new Set(),
      publicFetchError: null,
      error: error.message,
    };
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
const completedSteps = Math.min(targetSteps, currentIteration * stepsPerIteration);
const remainingSeconds = fps ? Math.max(0, targetSteps - completedSteps) / fps : null;
const checkpointEveryIterations = Math.max(
  1,
  Math.floor(checkpointEverySteps / stepsPerIteration),
);
const nextCheckpointIteration = Math.min(
  totalIterations,
  (Math.floor(currentIteration / checkpointEveryIterations) + 1) * checkpointEveryIterations,
);
const nextCheckpointSteps = Math.min(
  targetSteps,
  nextCheckpointIteration * stepsPerIteration,
);
const nextCheckpointRemainingSteps = Math.max(0, nextCheckpointSteps - completedSteps);
const nextCheckpointRemainingSeconds = fps
  ? nextCheckpointRemainingSteps / fps
  : null;

const evaluationFiles = (await filesIn(evaluationsDir, ".json")).filter(
  (file) => !file.name.endsWith(".submission.json"),
);
const evaluations = [];
for (const file of evaluationFiles) {
  try {
    evaluations.push(JSON.parse(await readFile(path.join(evaluationsDir, file.name), "utf8")));
  } catch {
    evaluations.push({ file: file.name, parseError: true });
  }
}

const submissionFiles = await filesIn(evaluationsDir, ".submission.json");
const submissions = [];
for (const file of submissionFiles) {
  try {
    submissions.push(JSON.parse(await readFile(path.join(evaluationsDir, file.name), "utf8")));
  } catch {
    submissions.push({ file: file.name, parseError: true });
  }
}

const leaderboard = await publicLeaderboard();
const submittedArchiveHashes = submissions
  .map((submission) => submission.archiveSha256)
  .filter(Boolean);
const bestEvaluatedXp = evaluations.reduce(
  (best, evaluation) => Math.max(best, Number(evaluation.publicBankMeanXp) || 0),
  0,
);
const bestSubmittedXp = submissions.reduce(
  (best, submission) => Math.max(best, Number(submission.publicBankMeanXp) || 0),
  0,
);

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
    nextCheckpoint: {
      iteration: nextCheckpointIteration,
      completedSteps: nextCheckpointSteps,
      fileName: `step${Math.floor(nextCheckpointSteps / 1_000_000)}M.safetensors`,
      stepsRemaining: nextCheckpointRemainingSteps,
      estimatedMinutes: nextCheckpointRemainingSeconds === null
        ? null
        : Number((nextCheckpointRemainingSeconds / 60).toFixed(1)),
      estimatedAt: nextCheckpointRemainingSeconds === null
        ? null
        : new Date(Date.now() + nextCheckpointRemainingSeconds * 1000).toISOString(),
    },
  },
  task: {
    referenceCode: "TSK-E4RXQS7X",
    netPrizeUsdc: 92.5,
    expiryTime: taskExpiry,
    hoursUntilExpiry: Number(((new Date(taskExpiry).getTime() - Date.now()) / 3_600_000).toFixed(2)),
    currentPublicLeaderXp: leaderboard.currentLeaderXp ?? 341.1,
    baseline20mPublicXp: 179.5,
    bestEvaluatedXp,
    bestSubmittedXp,
    minimumNextSubmissionXp,
    nextSubmissionRule: `Evaluate each stable checkpoint once. Submit only at or above ${minimumNextSubmissionXp} XP, or submit the best remaining unsubmitted checkpoint within two hours of expiry.`,
  },
  publicLeaderboard: {
    source: leaderboard.source,
    updatedAt: leaderboard.updatedAt,
    ownRows: leaderboard.ownRows,
    submittedArchivesAwaitingLeaderboard: submittedArchiveHashes.filter(
      (hash) => !leaderboard.observedArchiveHashes.has(hash),
    ),
    publicFetchError: leaderboard.publicFetchError,
    error: leaderboard.error,
  },
  checkpoints: await filesIn(checkpointDir, ".safetensors"),
  evaluations,
  submissions,
  countingPolicy: "Training and submissions do not count unless the benchmark is awarded, withdrawn, and transferred to the approved Base target.",
}, null, 2));
