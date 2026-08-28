import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const workspace = path.resolve(import.meta.dirname, "..");
const root = path.resolve(
  workspace,
  "deliverables/taskmarket/TSK-E4RXQS7X/death-gym",
);
const evaluationsDir = path.join(root, "local/evaluations");
const taskmarket = "/home/lenovo/.npm-global/bin/taskmarket";
const taskId = "0xace815c521a866aee6b474ed379160e73a933552b01c990b36b8937b88f3295a";
const workerAddress = "0xbb8f5dA5e6E14BD221e720D8e1798Fb8A5c7EA71";
const taskExpiry = new Date("2026-08-29T21:40:19.006Z").getTime();
const normalImprovementXp = 3;
const finalWindowMs = 2 * 60 * 60 * 1_000;
const submissionFeeBaseUnits = 1_000n;

function run(args, timeout = 90_000) {
  const stdout = execFileSync(taskmarket, args, {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  });
  const parsed = JSON.parse(stdout);
  if (parsed?.ok !== true) throw new Error(`Taskmarket rejected: ${stdout}`);
  return parsed.data;
}

function submissionList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.submissions)) return payload.submissions;
  if (Array.isArray(payload?.items)) return payload.items;
  throw new Error("Unexpected Taskmarket my-submissions response shape");
}

function artifactMatches(submission, sha256) {
  return (submission?.artifacts ?? []).some(
    (artifact) => artifact.sha256Hash?.toLowerCase() === sha256.toLowerCase(),
  );
}

function compactSubmission(submission) {
  return {
    taskId: submission.taskId,
    submissionId: submission.id ?? submission.submissionId ?? null,
    submittedAt: submission.submittedAt ?? null,
    submitTxHash: submission.submitTxHash ?? null,
    deliverableHash: submission.deliverableHash ?? null,
    workerAddress: submission.workerAddress ?? workerAddress,
    artifacts: (submission.artifacts ?? []).map((artifact) => ({
      fileName: artifact.fileName,
      role: artifact.role,
      sizeBytes: artifact.sizeBytes,
      sha256Hash: artifact.sha256Hash,
    })),
  };
}

function assertTaskCanReceiveSubmission(task) {
  if (task?.id?.toLowerCase() !== taskId.toLowerCase()) {
    throw new Error("Death Gym task identity mismatch");
  }
  if (String(task?.status ?? "").toLowerCase() !== "open") {
    throw new Error("Death Gym task is not open");
  }
  if (task?.submissionWindowOpen === false) {
    throw new Error("Death Gym submission window is closed");
  }
  if (task?.stakeRequired === true) {
    throw new Error("Death Gym unexpectedly requires a stake");
  }
  if (task?.expiryTime && Date.parse(task.expiryTime) <= Date.now()) {
    throw new Error("Death Gym task has expired");
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

const names = await readdir(evaluationsDir).catch((error) => {
  if (error.code === "ENOENT") return [];
  throw error;
});
const resultNames = names.filter(
  (name) => name.endsWith(".json") && !name.endsWith(".submission.json"),
);
const submissionNames = names.filter((name) => name.endsWith(".submission.json"));
const evaluations = await Promise.all(
  resultNames.map(async (name) => ({
    stem: name.replace(/\.json$/, ""),
    ...(await readJson(path.join(evaluationsDir, name))),
  })),
);
const recordedSubmissions = await Promise.all(
  submissionNames.map((name) => readJson(path.join(evaluationsDir, name))),
);
const bestSubmittedXp = recordedSubmissions.reduce(
  (best, submission) => Math.max(best, Number(submission.publicBankMeanXp) || 0),
  0,
);
const bestEvaluatedXp = evaluations.reduce(
  (best, evaluation) => Math.max(best, Number(evaluation.publicBankMeanXp) || 0),
  0,
);
const submittedHashes = new Set(
  recordedSubmissions.map((submission) => submission.archiveSha256).filter(Boolean),
);
const eligible = evaluations
  .filter(
    (evaluation) =>
      evaluation.validatorPassed === true &&
      Number.isFinite(Number(evaluation.publicBankMeanXp)) &&
      /^[0-9a-f]{64}$/i.test(evaluation.archiveSha256 ?? "") &&
      !submittedHashes.has(evaluation.archiveSha256),
  )
  .sort((a, b) => Number(b.publicBankMeanXp) - Number(a.publicBankMeanXp));
const timeUntilExpiryMs = taskExpiry - Date.now();
const inFinalWindow = timeUntilExpiryMs > 0 && timeUntilExpiryMs <= finalWindowMs;
const candidate =
  timeUntilExpiryMs > 0
    ? eligible.find((evaluation) => {
        const xp = Number(evaluation.publicBankMeanXp);
        return inFinalWindow
          ? xp > bestSubmittedXp
          : xp >= bestSubmittedXp + normalImprovementXp;
      })
    : null;

if (!candidate) {
  console.log(
    JSON.stringify(
      {
        status: "no-qualifying-checkpoint",
        bestEvaluatedXp,
        bestSubmittedXp,
        minimumNextXp: inFinalWindow ? `>${bestSubmittedXp}` : bestSubmittedXp + normalImprovementXp,
        inFinalWindow,
        expired: timeUntilExpiryMs <= 0,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

// Submitting creates a participant contract and currently costs 0.001 USDC.
// Do not let the five-minute timer repeatedly upload an artifact when the
// operator has not accepted the current legal bundle or the wallet cannot pay
// the disclosed fee.
const legal = run(["legal", "status"]);
if (legal.accepted !== true) {
  console.log(
    JSON.stringify(
      {
        status: "legal-acceptance-required",
        checkpoint: candidate.checkpoint,
        publicBankMeanXp: Number(candidate.publicBankMeanXp),
        bundleVersion: legal.bundleVersion ?? null,
        bundleStatus: legal.status ?? null,
        documents: legal.documents ?? [],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const wallet = run(["wallet", "balance"]);
const balanceBaseUnits = BigInt(wallet.balanceBaseUnits ?? "0");
if (balanceBaseUnits < submissionFeeBaseUnits) {
  console.log(
    JSON.stringify(
      {
        status: "insufficient-submission-balance",
        checkpoint: candidate.checkpoint,
        publicBankMeanXp: Number(candidate.publicBankMeanXp),
        balanceBaseUnits: balanceBaseUnits.toString(),
        requiredBaseUnits: submissionFeeBaseUnits.toString(),
        asset: "USDC",
        network: "eip155:8453",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const archivePath = path.resolve(root, candidate.archive);
const archiveBytes = await readFile(archivePath);
const actualHash = createHash("sha256").update(archiveBytes).digest("hex");
if (actualHash !== candidate.archiveSha256) {
  throw new Error(`Death Gym archive hash drift: ${actualHash}`);
}

// The cross-task `my-submissions` projection can lag and omits artifact metadata
// for benchmark rows. The authenticated task-specific endpoint is authoritative
// for idempotency because it returns the artifact SHA-256 needed to distinguish
// checkpoints.
const before = submissionList(run(["task", "submissions", taskId]));
let official = before.find(
  (submission) =>
    submission.taskId?.toLowerCase() === taskId.toLowerCase() &&
    artifactMatches(submission, candidate.archiveSha256),
);
let state = "already-submitted";
if (!official) {
  const task = run(["task", "get", taskId]);
  assertTaskCanReceiveSubmission(task);
  run(
    ["task", "submit", taskId, "--file", archivePath, "--role", "final"],
    240_000,
  );
  state = "submitted";
  const after = submissionList(run(["task", "submissions", taskId]));
  official = after.find(
    (submission) =>
      submission.taskId?.toLowerCase() === taskId.toLowerCase() &&
      artifactMatches(submission, candidate.archiveSha256),
  );
  if (!official) throw new Error("Official Death Gym submission readback is missing");
}

const evidence = {
  submittedAt: official.submittedAt ?? new Date().toISOString(),
  runName: candidate.runName ?? null,
  checkpoint: candidate.checkpoint,
  publicBankMeanXp: Number(candidate.publicBankMeanXp),
  archiveSha256: candidate.archiveSha256,
  ...compactSubmission(official),
  state,
  countingPolicy:
    "A submission is not income. Count only an awarded, withdrawn, independently verified Base-mainnet transfer to the target wallet.",
};
await writeFile(
  path.join(evaluationsDir, `${candidate.stem}.submission.json`),
  `${JSON.stringify(evidence, null, 2)}\n`,
  { mode: 0o600 },
);
console.log(JSON.stringify(evidence, null, 2));
