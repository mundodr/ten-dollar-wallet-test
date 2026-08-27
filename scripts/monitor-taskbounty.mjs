const apiUrl = "https://www.task-bounty.com/api/v1";

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(25_000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`TaskBounty returned HTTP ${response.status}`);
      }
      return body;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("TaskBounty returned no response");
}

const response = await fetchJson(`${apiUrl}/tasks?limit=100`);
const tasks = Array.isArray(response?.data)
  ? response.data
  : Array.isArray(response?.tasks)
    ? response.tasks
    : [];
const fundedOpenTasks = tasks.filter(
  (task) =>
    task.status === "OPEN" &&
    task.funding_status === "FUNDED" &&
    Number(task.bounty_cents) >= 1_000,
);

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      registered: false,
      registrationPendingEligibilityConfirmation: true,
      publicTaskCount: tasks.length,
      fundedOpenTaskCount: fundedOpenTasks.length,
      fundedOpenTasks: fundedOpenTasks.map((task) => ({
        id: task.id,
        title: task.title,
        category: task.category ?? null,
        bountyUsd: Number(task.bounty_cents) / 100,
        deadline: task.submission_deadline ?? null,
        githubRepoUrl: task.github_repo_url ?? null,
        githubIssueUrl: task.github_issue_url ?? null,
      })),
      payoutTarget: {
        network: "Base",
        asset: "USDC",
        address: "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18",
        configured: false,
      },
      nextAction:
        fundedOpenTasks.length > 0
          ? "Review the full task and confirm account eligibility before registration or submission."
          : "Keep monitoring the public funded-task feed.",
    },
    null,
    2,
  ),
);
