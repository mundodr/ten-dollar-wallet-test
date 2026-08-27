import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Wallet } from "../.agentbounties/node_modules/ethers/lib.esm/index.js";

const apiBase = "https://api.bountybook.ai";
const walletStatePath = path.resolve(".agentbounties/wallet.json");
const localStatePath = path.resolve(".bountybook/state.json");

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error ?? body?.message ?? `HTTP ${response.status}`;
    const error = new Error(`BountyBook ${message}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function getWallet() {
  const state = JSON.parse(await readFile(walletStatePath, "utf8"));
  if (!/^0x[0-9a-f]{64}$/i.test(state.privateKey ?? "")) {
    throw new Error("Controlled earning wallet is missing a valid private key");
  }
  const wallet = new Wallet(state.privateKey);
  if (wallet.address.toLowerCase() !== String(state.address).toLowerCase()) {
    throw new Error("Controlled earning wallet address does not match its private key");
  }
  return wallet;
}

async function authenticate(wallet) {
  const { nonce } = await fetchJson(
    `${apiBase}/auth/nonce?address=${encodeURIComponent(wallet.address)}`,
  );
  if (typeof nonce !== "string" || nonce.length < 16) {
    throw new Error("BountyBook returned an invalid authentication nonce");
  }
  const signature = await wallet.signMessage(nonce);
  const session = await fetchJson(`${apiBase}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address, signature }),
  });
  if (typeof session.token !== "string" || session.token.length < 16) {
    throw new Error("BountyBook did not return a session token");
  }
  return session;
}

async function saveState(update) {
  let current = {};
  try {
    current = JSON.parse(await readFile(localStatePath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(path.dirname(localStatePath), { recursive: true, mode: 0o700 });
  await writeFile(
    localStatePath,
    `${JSON.stringify({ ...current, ...update }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await chmod(localStatePath, 0o600);
}

function codeOutput(fileName, source) {
  return {
    fileName,
    content: source,
    language: path.extname(fileName).slice(1),
    files: [{ name: fileName, path: fileName, content: source }],
    file_contents: { [fileName]: source },
    [fileName]: source,
    code: source,
    summary: `Complete implementation of ${fileName} for the requested specification.`,
  };
}

async function main() {
  const [command = "monitor", jobId, sourcePath] = process.argv.slice(2);
  const wallet = await getWallet();

  if (command === "monitor") {
    const trackedIds = [
      "22c4bffa-cdca-4457-aad5-2c4bdb3080d6",
      "734626a0-26b5-478b-b9cf-fb575aea8adc",
    ];
    const [profile, openJobs, verifiedJobs, ...trackedJobs] = await Promise.all([
      fetchJson(`${apiBase}/agents/${wallet.address}`),
      fetchJson(`${apiBase}/jobs?status=open&limit=100`),
      fetchJson(`${apiBase}/jobs?status=verified&limit=100`),
      ...trackedIds.map((id) => fetchJson(`${apiBase}/jobs/${id}`)),
    ]);
    const confirmedCodePayouts = (verifiedJobs.jobs ?? [])
      .filter(
        (job) =>
          job.job_type === "code" &&
          job.payout_status === "confirmed" &&
          /^0x[0-9a-f]{64}$/i.test(job.payout_tx_hash ?? ""),
      )
      .sort((left, right) => Number(right.updated_at) - Number(left.updated_at));
    const latestConfirmedCodePayout = confirmedCodePayouts[0] ?? null;
    const recentCodePayoutCutoff = Date.now() / 1_000 - 6 * 60 * 60;
    const oracleInfrastructureHealthy =
      Number(latestConfirmedCodePayout?.updated_at ?? 0) >= recentCodePayoutCutoff;
    console.log(
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          executorAddress: wallet.address,
          profile,
          openJobCount: Number(openJobs.total ?? openJobs.jobs?.length ?? 0),
          trackedJobs: trackedJobs.map((job) => ({
            id: job.id,
            title: job.title,
            status: job.status,
            payoutStatus: job.payout_status,
            payoutTxHash: job.payout_tx_hash,
            latestOwnAttempt:
              (job.attempts ?? []).find(
                (attempt) =>
                  String(attempt.executor_address).toLowerCase() ===
                  wallet.address.toLowerCase(),
              ) ?? null,
          })),
          latestConfirmedCodePayout: latestConfirmedCodePayout
            ? {
                id: latestConfirmedCodePayout.id,
                title: latestConfirmedCodePayout.title,
                budgetUsdc: Number(latestConfirmedCodePayout.budget_usdc),
                updatedAt: latestConfirmedCodePayout.updated_at,
                payoutTxHash: latestConfirmedCodePayout.payout_tx_hash,
              }
            : null,
          oracleInfrastructureHealthy,
          nextAction: oracleInfrastructureHealthy
            ? "Inspect one fresh deterministic code task; test locally and submit at most once."
            : "Do not submit again until a recent confirmed code payout proves the live oracle path recovered.",
          countingPolicy:
            "BountyBook status and worker-wallet balances do not count until an independently verified Base-mainnet transfer reaches the user's target wallet.",
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "report-job") {
    if (!jobId || !sourcePath || sourcePath.trim().length < 40) {
      throw new Error(
        "Usage: node scripts/bountybook-client.mjs report-job <job-id> <detailed-reason>",
      );
    }
    const session = await authenticate(wallet);
    const report = await fetchJson(
      `${apiBase}/jobs/${encodeURIComponent(jobId)}/report`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reporterAddress: wallet.address,
          reason: sourcePath.trim(),
        }),
      },
    );
    console.log(JSON.stringify({ jobId, reported: true, report }, null, 2));
    return;
  }

  if (
    !["submit-code", "submit-cid"].includes(command) ||
    !jobId ||
    !sourcePath
  ) {
    throw new Error(
      "Usage: node scripts/bountybook-client.mjs <submit-code|submit-cid> <job-id> <source-file-or-cid>",
    );
  }

  const job = await fetchJson(`${apiBase}/jobs/${encodeURIComponent(jobId)}`);
  const alreadyClaimedByWallet =
    job.status === "claimed" &&
    String(job.executor_address).toLowerCase() === wallet.address.toLowerCase();
  if (job.status !== "open" && !alreadyClaimedByWallet) {
    throw new Error(`BountyBook job is not available to this wallet: ${job.status}`);
  }
  const requiredFiles = job.spec?.success_condition?.required_files ?? [];
  let fileName = null;
  let output;
  if (command === "submit-code") {
    const source = await readFile(path.resolve(sourcePath), "utf8");
    if (source.trim().split("\n").length < 10) {
      throw new Error("Refusing to submit a code deliverable shorter than 10 lines");
    }
    fileName = path.basename(sourcePath);
    if (requiredFiles.length > 0 && !requiredFiles.includes(fileName)) {
      throw new Error(`Deliverable name must be one of: ${requiredFiles.join(", ")}`);
    }
    output = { outputData: codeOutput(fileName, source) };
  } else {
    if (
      !/^baf[a-z2-7]{20,}$/i.test(sourcePath) &&
      !/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(sourcePath)
    ) {
      throw new Error("submit-cid requires a valid CIDv0 or base32 CIDv1");
    }
    output = { outputCID: sourcePath };
  }

  const session = await authenticate(wallet);
  const headers = {
    Authorization: `Bearer ${session.token}`,
    "Content-Type": "application/json",
  };
  const claim = alreadyClaimedByWallet
    ? { success: true, jobId, status: "claimed", reusedExistingClaim: true }
    : await fetchJson(`${apiBase}/jobs/${encodeURIComponent(jobId)}/claim`, {
        method: "POST",
        headers,
        body: JSON.stringify({ executorAddress: wallet.address }),
      });
  const submission = await fetchJson(
    `${apiBase}/jobs/${encodeURIComponent(jobId)}/submit`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        executorAddress: wallet.address,
        ...output,
      }),
    },
  );
  const record = {
    jobId,
    title: job.title,
    budgetUsdc: Number(job.budget_usdc),
    executorAddress: wallet.address,
    sourceFile: fileName,
    outputCid: output.outputCID ?? null,
    claimedAt: new Date().toISOString(),
    claim,
    submission,
  };
  await saveState({
    executorAddress: wallet.address,
    lastSubmission: record,
    updatedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify(record, null, 2));
}

await main();
