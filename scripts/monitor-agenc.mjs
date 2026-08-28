import { createHash } from "node:crypto";

const apiBase = "https://agenc.ag/api";
const programId = "HJsZ53Zb27b8QMRbQpuDngE44AdwCGxvEZr61Zmxw1xK";
const targetWallet = "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt";

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastError;
}

async function verifySpec(task) {
  if (
    !/^https:\/\//i.test(task.jobSpecUri ?? "") ||
    !/^[0-9a-f]{64}$/i.test(task.jobSpecHash ?? "")
  ) {
    return false;
  }
  try {
    const response = await fetch(task.jobSpecUri, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return false;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 2 * 1024 * 1024) return false;
    return createHash("sha256").update(bytes).digest("hex") === task.jobSpecHash;
  } catch {
    return false;
  }
}

const pages = await Promise.all(
  [1, 2, 3, 4].map((page) =>
    fetchJson(
      page === 1
        ? `${apiBase}/tasks?pageSize=100`
        : `${apiBase}/tasks?page=${page}&pageSize=100`,
    ),
  ),
);
const tasks = pages.flatMap((page) => page.items ?? []);
const now = Math.floor(Date.now() / 1000);
const claimable = tasks.filter(
  (task) =>
    task.status === "open" &&
    task.verified === true &&
    task.actionability?.claimablePublicly === true &&
    Number(task.deadlineUnix ?? 0) > now,
);
const candidates = await Promise.all(
  claimable.map(async (task) => {
    const minimumStakeLamports = BigInt(
      task.actionability?.minAgentStakeLamports ?? "0",
    );
    const specHashVerified = await verifySpec(task);
    const exclusions = [];
    if (!specHashVerified) exclusions.push("pinned HTTPS job spec did not verify");
    if (minimumStakeLamports > 0n) {
      exclusions.push("requires a participant-funded mainnet agent stake");
    }
    return {
      taskPda: task.pda,
      rewardLamports: task.rewardLamports,
      rewardSol: Number(task.rewardLamports) / 1e9,
      deadlineUnix: task.deadlineUnix,
      minimumStakeLamports: minimumStakeLamports.toString(),
      specHashVerified,
      exclusions,
      actionableWithoutUserFunds: exclusions.length === 0,
    };
  }),
);

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      programId,
      network: "solana-mainnet",
      targetWallet,
      scannedTasks: tasks.length,
      publiclyClaimableCount: candidates.length,
      actionableWithoutUserFunds: candidates.filter(
        (candidate) => candidate.actionableWithoutUserFunds,
      ),
      excludedCandidates: candidates.filter(
        (candidate) => !candidate.actionableWithoutUserFunds,
      ),
      nextAction: candidates.some(
        (candidate) => candidate.actionableWithoutUserFunds,
      )
        ? "Review the verified zero-stake task before any setup or signing action."
        : "Keep the public mainnet board read-only until a verified zero-stake task appears.",
      countingPolicy:
        "Task rows, escrow, claims, submissions, and intermediary wallets do not count; only a matching Solana-mainnet receipt at the disclosed target counts.",
    },
    null,
    2,
  ),
);
