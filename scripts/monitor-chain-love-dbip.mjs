import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const issueApi = "https://api.github.com/repos/Chain-Love/chain-love/issues/3340";
const issueUrl = "https://github.com/Chain-Love/chain-love/issues/3340";
const pullRequestApi = "https://api.github.com/repos/Chain-Love/chain-love/pulls/3354";
const pullRequestUrl = "https://github.com/Chain-Love/chain-love/pull/3354";
const expectedAuthor = "mundodr";
const target = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const ethereumRpcs = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com/eth",
];
const tokens = [
  {
    symbol: "USDC",
    contract: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    decimals: 6,
  },
  {
    symbol: "USDT",
    contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    decimals: 6,
  },
];

async function github(path) {
  const resource = new URL(path).pathname.slice(1) + new URL(path).search;
  const { stdout } = await execFileAsync(
    "/home/lenovo/.local/bin/gh",
    [
      "api",
      resource,
      "--header",
      "Accept: application/vnd.github+json",
      "--header",
      "X-GitHub-Api-Version: 2022-11-28",
    ],
    { timeout: 20_000, maxBuffer: 5 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

async function rpc(method, params) {
  const failures = [];
  for (const endpoint of ethereumRpcs) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => null);
      if (
        response.ok &&
        body !== null &&
        body.error === undefined &&
        body.result !== undefined
      ) {
        return body.result;
      }
      failures.push(
        `${new URL(endpoint).hostname}:HTTP ${response.status}:${body?.error?.code ?? "invalid-body"}`,
      );
    } catch (error) {
      failures.push(
        `${new URL(endpoint).hostname}:${error instanceof Error ? error.name : "error"}`,
      );
    }
  }
  throw new Error(`Ethereum RPC failed: ${failures.join(", ")}`);
}

function balanceOfData(address) {
  return `0x70a08231${address.slice(2).padStart(64, "0")}`;
}

const [issue, comments, pullRequest, pullRequestComments, rawEth, tokenBalances] = await Promise.all([
  github(issueApi),
  github(`${issueApi}/comments?per_page=100`),
  github(pullRequestApi),
  github("https://api.github.com/repos/Chain-Love/chain-love/issues/3354/comments?per_page=100"),
  rpc("eth_getBalance", [target, "latest"]),
  Promise.all(
    tokens.map(async (token) => {
      const raw = await rpc("eth_call", [
        { to: token.contract, data: balanceOfData(target) },
        "latest",
      ]);
      return {
        ...token,
        raw: BigInt(raw).toString(),
        balance: Number(BigInt(raw)) / 10 ** token.decimals,
      };
    }),
  ),
]);

const labels = issue.labels.map((label) =>
  typeof label === "string" ? label : label.name,
);
const maintainerFeedback = comments
  .filter((comment) => comment.user?.login !== expectedAuthor)
  .map((comment) => ({
    author: comment.user?.login ?? null,
    association: comment.author_association ?? null,
    createdAt: comment.created_at,
    url: comment.html_url,
    preview: (comment.body ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
  }));
const eth = Number(BigInt(rawEth)) / 1e18;
const scopeReview = pullRequestComments.find(
  (comment) =>
    comment.user?.login === expectedAuthor &&
    (comment.body ?? "").includes("The implementation is not ready to close the DBIP yet"),
);
const pullRequestHeadSha = pullRequest.head?.sha ?? null;
const checkRuns = pullRequestHeadSha
  ? await github(
      `https://api.github.com/repos/Chain-Love/chain-love/commits/${pullRequestHeadSha}/check-runs?per_page=100`,
    )
  : { check_runs: [] };
const checks = (checkRuns.check_runs ?? []).map((check) => ({
  name: check.name,
  status: check.status,
  conclusion: check.conclusion,
  url: check.html_url,
}));
const checksPassing =
  checks.length > 0 &&
  checks.every((check) =>
    ["success", "neutral", "skipped"].includes(check.conclusion),
  );
const implementationComplete =
  pullRequest.merged === true &&
  checksPassing &&
  labels.includes("DBIP");

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      proposal: {
        url: issueUrl,
        number: issue.number,
        title: issue.title,
        state: issue.state,
        author: issue.user?.login ?? null,
        exactAuthor: issue.user?.login === expectedAuthor,
        labels,
        dbipLabelPresent: labels.includes("DBIP"),
        rewardAddressPresent: (issue.body ?? "")
          .toLowerCase()
          .includes(target.toLowerCase()),
        comments: issue.comments,
        maintainerFeedback,
        updatedAt: issue.updated_at,
      },
      linkedImplementation: {
        url: pullRequestUrl,
        number: pullRequest.number,
        title: pullRequest.title,
        state: pullRequest.state,
        merged: pullRequest.merged,
        author: pullRequest.user?.login ?? null,
        headSha: pullRequestHeadSha,
        changedFiles: pullRequest.changed_files,
        additions: pullRequest.additions,
        deletions: pullRequest.deletions,
        checks,
        checksPassing,
        scopeReviewPosted: Boolean(scopeReview),
        scopeReviewUrl: scopeReview?.html_url ?? null,
        implementationComplete,
      },
      ethereumMainnet: {
        chainId: 1,
        target,
        eth,
        tokens: tokenBalances,
        stablecoinTotal: tokenBalances.reduce(
          (sum, token) => sum + token.balance,
          0,
        ),
      },
      nextAction: labels.includes("DBIP")
        ? implementationComplete
          ? "Monitor the documented monthly reward cycle and independently verify the exact Ethereum-mainnet receipt."
          : "The DBIP is approved; wait for the linked implementation to pass review without duplicating the contributor's work."
        : pullRequest.state === "open"
          ? "Wait for explicit maintainer DBIP approval and the contributor's schema/wiki/size correction; the one factual scope review is already posted."
          : "Keep the proposal open for explicit maintainer review; do not treat a closed or unmerged third-party PR as approval.",
      countingPolicy:
        "Proposal approval, labels, comments and promised rewards are not funds. Count only a successful Ethereum-mainnet receipt independently visible at the exact locally controlled target.",
    },
    null,
    2,
  ),
);
