const apiBase = "https://api.taskmarket.dev/api";
const agentAddress = "0xbb8f5dA5e6E14BD221e720D8e1798Fb8A5c7EA71";
const targetWithdrawalAddress = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const trackedItems = [
  {
    taskId:
      "0x1fe2f010cea65da7a71af3559c95a88847e09c85a4f566d09d7a18f31fb8287b",
    submissionId: "b333c159-877a-4c2e-9d02-9640bd08d2ee",
  },
  {
    taskId:
      "0x78df3fe6a4616b2b151a67244c718603d5f30d15a17c76be782927c89d939475",
    submissionId: "9cb93bf5-a9d7-41b2-84b7-93c27a79bbd6",
  },
  {
    taskId:
      "0xf709a6d1f271d14dbc11544993cb7418438e3cb2b108d657d947685c75e5ffd5",
    submissionId: "a854b3b8-dd5d-4027-8794-d34ca56863e9",
  },
  {
    taskId:
      "0x02c85a21787b5bc43e1d428939f4f91049c61e4ad7ce3cdebc41d29040447e68",
    submissionId: "156a6bdf-c405-4edf-b6ad-a8ae73b3fe48",
    submittedAt: "2026-08-27T15:52:06.689Z",
    deliverableHash:
      "0x878c39b743936b97640099b44824ae17ad89423a9703f39c8abee31da910b23d",
    submitTxHash:
      "0x0b598da3f4b338f51eef721bdb07585ef869ff4c75d9e920d82b45c2e84ac3a5",
  },
  {
    taskId:
      "0xfc767ac1fd6349c1726d6d7ac37633ba611519d5cedd05f85c15fe6c19f4c90b",
    submissionId: "1c00eabb-9e5d-4e1f-94a3-244c32361935",
    submittedAt: "2026-08-27T16:02:53.964Z",
    deliverableHash:
      "0x491d427ecb53fbb1ad567da0bedb49932a70d79d4df34647b9b751779575bc05",
    submitTxHash:
      "0xa998491c0276dbf3ea82541ef8829536bb5343738a5afcbb62e001b3d1148e77",
  },
  {
    taskId:
      "0x0f50fb11e2c983117a758986f8f6808f5959ec7abfca596cef74ca67f863dbdc",
    submissionId: "38d12cc8-6730-4a11-82e0-5d1bf24dde51",
    submittedAt: "2026-08-27T16:33:39.714Z",
    deliverableHash:
      "0x5ee007b1a0bfd374c359b5cd297536472a7bffed63aebf78a6597132d4bfcee1",
    submitTxHash:
      "0xbdbf33ff82fbc1a8b7891ac7012bd41060701b99d1ecf2997d6d27bfe60232df",
  },
  {
    taskId:
      "0x992af430519bc0a987b725e794cf5953f122fa38c0ea1f626a328cf897af7bad",
    submissionId: "7c7ea2f2-5b68-4256-9c0d-0ce8955747ab",
    submittedAt: "2026-08-27T16:43:12.378Z",
    deliverableHash:
      "0xcf285e43aa3743cc5992333cda3dc67b201cde9d0c6739fa3dad50e3844e7f8d",
    submitTxHash:
      "0xcaf236a13148f61156f758d9a73a749422d8960696ca019e2af765c2e111c10e",
  },
  {
    taskId:
      "0xace815c521a866aee6b474ed379160e73a933552b01c990b36b8937b88f3295a",
    submissionId: "f248bcfa-d8f7-46c4-aedd-b4161da4da00",
    submittedAt: "2026-08-27T22:58:48.203Z",
    deliverableHash:
      "0xc48f0ba66cc9683b57721cd772551ffc0c8e65ffac29cf48389ca2cb1ee36d92",
    submitTxHash:
      "0x20b2ee5fac5de71676b19134587789dd9fa88f904e56f700f2df0bdfc758e301",
  },
  {
    taskId:
      "0x00689990ba153dbcadb14f7744b6dad7b2d2437c17db0c0f1eb28405a2fc2f0e",
    submissionId: "cdd45d16-34e4-48ba-aef4-62da0ec84e69",
    submittedAt: "2026-08-27T19:30:40.710Z",
    deliverableHash:
      "0xff0fa76e61854a1efc90969057ae2c99fdcba50b49124937bd99e7d395057b28",
    submitTxHash:
      "0x4861d459dce94f255123d7ebcb36b4fd63e6343846746f442e9bc7a26d38ea23",
  },
  {
    taskId:
      "0x55c9b5110de9642734f2fca82504845cf7fa1cd4389c9ca1600aa271eec47d9c",
    submissionId: "b86ab254-8df7-4ffb-ad79-0d801a8efbe5",
    submittedAt: "2026-08-27T23:57:22.016Z",
    deliverableHash:
      "0xffafb5da308c502ff86004691432ecc23911c0c23ed2fcbee4fb3286180cb37e",
    submitTxHash:
      "0xf7207cc1b015890f5dd7a9110e9d749d7d89f2ea84287971d0e9cd298b59af11",
  },
  {
    taskId:
      "0x02948fdb2cf71b1dfb70e0920fe9c37878e7045fca275216f3a5a9c801a6b40b",
    submissionId: "df167db1-1323-4ca7-981a-84a43d7d42f6",
    submittedAt: "2026-08-27T23:57:30.479Z",
    deliverableHash:
      "0xa9af09d15581855175f10949dfd0768743f4a6158bd79f4671110aaf94113318",
    submitTxHash:
      "0xe3bf5992008b93a86cf76c8ca14dd20c9dadf502d79f8686ec0542fe3353caad",
  },
];

async function fetchJson(pathname, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${apiBase}${pathname}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(`Taskmarket ${pathname} failed (${response.status})`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return body;
    } catch (error) {
      lastError = error;
      if (error.retryable === false || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

const encodedAddress = encodeURIComponent(agentAddress);
const [taskList, agent, balance, withdrawal, ...trackedResponses] = await Promise.all([
  fetchJson("/tasks?status=open&limit=100&sort=reward_desc"),
  fetchJson(`/agents/stats?address=${encodedAddress}`),
  fetchJson(`/wallet/balance?address=${encodedAddress}`),
  fetchJson(`/wallet/withdrawal-address?address=${encodedAddress}`),
  ...trackedItems.flatMap(({ taskId }) => {
    const encodedTaskId = encodeURIComponent(taskId);
    return [
      fetchJson(`/tasks/${encodedTaskId}`),
      fetchJson(`/tasks/${encodedTaskId}/submissions`),
    ];
  }),
]);

const openTasks = Array.isArray(taskList?.tasks) ? taskList.tasks : [];
const trackedTasks = trackedItems.map((item, index) => {
  const task = trackedResponses[index * 2];
  const submissionResponse = trackedResponses[index * 2 + 1];
  const taskSubmissions = Array.isArray(submissionResponse)
    ? submissionResponse
    : submissionResponse?.submissions ?? [];
  const submission = taskSubmissions.find(
    (candidate) => candidate.id === item.submissionId,
  );
  return {
    id: task.id ?? item.taskId,
    referenceCode: task.referenceCode ?? null,
    status: task.status ?? null,
    netRewardUsdc: Number(task.netReward ?? task.reward ?? 0) / 1e6,
    submissionCount: task.submissionCount ?? taskSubmissions.length,
    awardCount: task.awardCount ?? 0,
    primaryAward: task.primaryAward ?? null,
    expiryTime: task.expiryTime ?? null,
    submissionVisibility: task.submissionVisibility ?? null,
    publicSubmissionVisible: Boolean(submission),
    submission: submission
      ? {
          id: submission.id,
          workerAddress: submission.workerAddress,
          submittedAt: submission.submittedAt,
          submitTxHash: submission.submitTxHash ?? null,
          artifacts: (submission.artifacts ?? []).map((artifact) => ({
            fileName: artifact.fileName,
            role: artifact.role,
            sizeBytes: artifact.sizeBytes,
            sha256Hash: artifact.sha256Hash,
          })),
        }
      : item.submitTxHash
        ? {
            id: item.submissionId,
            workerAddress: agentAddress,
            submittedAt: item.submittedAt,
            submitTxHash: item.submitTxHash,
            deliverableHash: item.deliverableHash,
            artifacts: null,
            visibility:
              task.submissionVisibility === "reveal_all"
                ? "hidden-until-task-reveal"
                : "not-returned-by-public-task-submissions-endpoint",
          }
        : null,
  };
});
const exactWithdrawalTarget =
  withdrawal?.withdrawalAddress?.toLowerCase() === targetWithdrawalAddress;
if (!exactWithdrawalTarget) {
  throw new Error("Taskmarket withdrawal address drifted from the approved Base target");
}

const excludedOpportunityPattern =
  /buyer|sales|lead|social|tweet|reddit|follow|vote|paid bid|payment test|brand kit/i;
const eligibleOpenTasks = openTasks
  .filter(
    (item) =>
      item.submissionWindowOpen !== false &&
      item.stakeRequired !== true &&
      !trackedItems.some((tracked) => tracked.taskId === item.id) &&
      Number(item.netReward ?? item.reward ?? 0) >= 1_000_000 &&
      !excludedOpportunityPattern.test(
        `${item.description ?? ""} ${(item.tags ?? []).join(" ")}`,
      ),
  )
  .map((item) => ({
    id: item.id,
    referenceCode: item.referenceCode ?? null,
    title: item.description?.split(/\n/)[0]?.replace(/^#+\s*/, "") ?? null,
    netRewardUsdc: Number(item.netReward ?? item.reward ?? 0) / 1e6,
    mode: item.mode,
    submissionCount: item.submissionCount ?? 0,
    expiryTime: item.expiryTime,
    escrowTxHash: item.escrowTxHash ?? null,
  }));

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agent: {
        address: agent.address ?? agentAddress,
        agentId: agent.agentId ?? null,
        actorType: agent.actorType ?? null,
        emailAddress: agent.emailAddress ?? null,
        completedTasks: agent.completedTasks ?? 0,
        totalEarningsBaseUnits: agent.totalEarnings ?? "0",
      },
      wallet: {
        platformUsdc: balance.balanceUsdc ?? "0.000000",
        withdrawalAddress: withdrawal.withdrawalAddress,
        exactWithdrawalTarget,
      },
      trackedTasks,
      eligibleOpenTaskCount: eligibleOpenTasks.length,
      eligibleOpenTasks,
      nextAction:
        Number(balance.balanceBaseUnits ?? 0) > 0
          ? "Withdraw earned USDC to the pre-approved Base target and verify the target-chain transfer."
          : "Monitor all eleven funded submissions and new no-stake opportunities.",
      countingPolicy:
        "Taskmarket balances, submissions, and awards do not count until a matching Base transfer reaches the target address.",
    },
    null,
    2,
  ),
);
