#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("deliverables/taskmarket/TSK-E4RXQS7X/death-gym");
const checkpointDir = path.join(root, "local/checkpoints/long-5b");
const outputDir = path.join(root, "local/evaluations");
const python = path.join(root, ".venv/bin/python");
const requested = process.argv[2] || null;

await mkdir(outputDir, { recursive: true });
const names = (await readdir(checkpointDir).catch((error) => {
  if (error.code === "ENOENT") return [];
  throw error;
}))
  .filter((name) => name.endsWith(".safetensors"))
  .sort((a, b) => {
    const aStep = Number(a.match(/step(\d+)M/)?.[1] ?? (a === "final.safetensors" ? Number.MAX_SAFE_INTEGER : -1));
    const bStep = Number(b.match(/step(\d+)M/)?.[1] ?? (b === "final.safetensors" ? Number.MAX_SAFE_INTEGER : -1));
    return bStep - aStep;
  });
const checkpointName = requested || names[0];
if (!checkpointName) {
  console.log(JSON.stringify({ status: "no-checkpoint" }, null, 2));
  process.exit(0);
}
if (!names.includes(checkpointName)) throw new Error(`Checkpoint not found: ${checkpointName}`);

const stem = checkpointName.replace(/\.safetensors$/, "");
const checkpoint = path.join(checkpointDir, checkpointName);
const archive = path.join(outputDir, `${stem}.zip`);
const resultFile = path.join(outputDir, `${stem}.json`);
const transcriptFile = path.join(outputDir, `${stem}.txt`);
const lockFile = path.join(outputDir, `${stem}.lock`);

try {
  const existing = JSON.parse(await readFile(resultFile, "utf8"));
  console.log(JSON.stringify({ status: "already-evaluated", result: existing }, null, 2));
  process.exit(0);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const checkpointInfo = await stat(checkpoint);
if (Date.now() - checkpointInfo.mtimeMs < 30_000) {
  console.log(JSON.stringify({ status: "checkpoint-too-new", checkpoint: checkpointName, retryAfterSeconds: 30 }, null, 2));
  process.exit(0);
}

let lock;
try {
  lock = await open(lockFile, "wx", 0o600);
} catch (error) {
  if (error.code === "EEXIST") {
    console.log(JSON.stringify({ status: "evaluation-already-running", checkpoint: checkpointName }, null, 2));
    process.exit(0);
  }
  throw error;
}

try {
  const exportOutput = execFileSync(
    python,
    [path.join(root, "tools/export_submission.py"), checkpoint, "-o", archive],
    { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  const evaluationOutput = execFileSync(
    python,
    [path.join(root, "tools/evaluate_submission.py"), archive, "--quiet"],
    { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  const score = Number(evaluationOutput.match(/eval_avg_xp:\s+([0-9.]+)/)?.[1]);
  if (!Number.isFinite(score)) throw new Error("Could not parse eval_avg_xp from evaluator output");
  const archiveBytes = await readFile(archive);
  const result = {
    evaluatedAt: new Date().toISOString(),
    checkpoint: checkpointName,
    checkpointSizeBytes: checkpointInfo.size,
    archive: path.relative(root, archive),
    archiveSizeBytes: archiveBytes.length,
    archiveSha256: createHash("sha256").update(archiveBytes).digest("hex"),
    publicBankMeanXp: score,
    publicBankSeeds: [3930, 7717, 20477],
    publicBankWorldsPerSeed: 16384,
    validatorPassed: /validated OK/.test(exportOutput),
    publicLeaderAtRunStartXp: 341.1,
  };
  await writeFile(transcriptFile, `${exportOutput}\n${evaluationOutput}`);
  await writeFile(resultFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: "evaluated", result }, null, 2));
} finally {
  await lock.close();
  await rm(lockFile, { force: true });
}
