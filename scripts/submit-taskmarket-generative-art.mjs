import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "..");
const taskmarket = "/home/lenovo/.npm-global/bin/taskmarket";
const workerAddress = "0xbb8f5dA5e6E14BD221e720D8e1798Fb8A5c7EA71";
const stateDirectory = resolve(workspace, ".taskmarket-generative-art");
const statePath = resolve(stateDirectory, "last.json");

const tasks = [
  {
    taskId:
      "0x55c9b5110de9642734f2fca82504845cf7fa1cd4389c9ca1600aa271eec47d9c",
    referenceCode: "TSK-4M83XEN0",
    archive: {
      path: "deliverables/taskmarket/TSK-4M83XEN0-lattice-orchard.zip",
      sha256: "3c045c70b550a32d0ffd46eb263b556bcf544b6d47d78e37ba5e4ac24535d66f",
    },
    preview: {
      path: "deliverables/taskmarket/TSK-4M83XEN0-infinite-garden/capture-seed-731941.png",
      sha256: "6f000da991f93264e088495cd8bc513519f137ec773a81a1307a9b7fc12dd176",
    },
  },
  {
    taskId:
      "0x02948fdb2cf71b1dfb70e0920fe9c37878e7045fca275216f3a5a9c801a6b40b",
    referenceCode: "TSK-9Z9HENXP",
    archive: {
      path: "deliverables/taskmarket/TSK-9Z9HENXP-pelagic-oscillator.zip",
      sha256: "fd6b29c3cd5e883b22024541349da20c0f8b85db0a8a60e9892d206f78739d02",
    },
    preview: {
      path: "deliverables/taskmarket/TSK-9Z9HENXP-mathematical-creature/capture-seed-104729.png",
      sha256: "ba423b4eb2741078888ff29bb4fc70d82af850d008dec1c5112327e8dcded04d",
    },
  },
];

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

async function assertHash(item) {
  const absolutePath = resolve(workspace, item.path);
  const bytes = await readFile(absolutePath);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== item.sha256) {
    throw new Error(`Artifact hash drift for ${item.path}: ${actual}`);
  }
  return absolutePath;
}

function assertTaskCanReceiveSubmission(task, expected) {
  if (task?.id?.toLowerCase() !== expected.taskId.toLowerCase()) {
    throw new Error(`Task identity mismatch for ${expected.referenceCode}`);
  }
  if (String(task?.status ?? "").toLowerCase() !== "open") {
    throw new Error(`${expected.referenceCode} is not open`);
  }
  if (task?.submissionWindowOpen === false) {
    throw new Error(`${expected.referenceCode} submission window is closed`);
  }
  if (task?.stakeRequired === true) {
    throw new Error(`${expected.referenceCode} unexpectedly requires stake`);
  }
  if (task?.expiryTime && Date.parse(task.expiryTime) <= Date.now()) {
    throw new Error(`${expected.referenceCode} has expired`);
  }
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

await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
const before = submissionList(run(["task", "my-submissions"]));
const results = [];

for (const item of tasks) {
  const existing = before.find(
    (submission) => submission.taskId?.toLowerCase() === item.taskId.toLowerCase(),
  );
  if (existing) {
    results.push({
      referenceCode: item.referenceCode,
      state: "already-submitted",
      ...compactSubmission(existing),
    });
    continue;
  }

  const task = run(["task", "get", item.taskId]);
  assertTaskCanReceiveSubmission(task, item);
  const archivePath = await assertHash(item.archive);
  const previewPath = await assertHash(item.preview);
  const submission = run(
    [
      "task",
      "submit",
      item.taskId,
      "--file",
      archivePath,
      "--file",
      previewPath,
      "--role",
      "final",
    ],
    240_000,
  );
  results.push({
    referenceCode: item.referenceCode,
    state: "submitted-awaiting-readback",
    taskId: item.taskId,
    submissionId: submission.submissionId,
  });
}

const after = submissionList(run(["task", "my-submissions"]));
const readback = tasks.map((item) => {
  const submission = after.find(
    (candidate) => candidate.taskId?.toLowerCase() === item.taskId.toLowerCase(),
  );
  if (!submission) throw new Error(`Official readback missing for ${item.referenceCode}`);
  return { referenceCode: item.referenceCode, ...compactSubmission(submission) };
});

const evidence = {
  checkedAt: new Date().toISOString(),
  workerAddress,
  results,
  readback,
  countingPolicy:
    "Submissions and awards are workflow evidence only. Count funds only after an independently verified mainnet transfer reaches the disclosed target wallet.",
};
await writeFile(statePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(evidence, null, 2));
