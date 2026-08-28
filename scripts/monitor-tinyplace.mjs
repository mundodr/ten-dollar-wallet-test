const API_BASE = "https://api.tiny.place";
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TARGET = "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt";

async function fetchJson(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text.slice(0, 500) };
      }
      if (!response.ok) {
        throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
    }
  }
  throw lastError;
}

async function verifyFunding(signature, escrowOwner, expectedRawAmount) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature ?? "")) {
    return { verified: false, reason: "missing or malformed funding signature" };
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(escrowOwner ?? "")) {
    return { verified: false, reason: "missing or malformed escrow owner" };
  }

  const rpc = await fetchJson(SOLANA_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        signature,
        {
          encoding: "jsonParsed",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        },
      ],
    }),
  });
  const transaction = rpc?.result;
  if (!transaction || transaction.meta?.err) {
    return {
      verified: false,
      reason: transaction ? "funding transaction failed" : "funding transaction unavailable",
    };
  }

  const preByIndex = new Map(
    (transaction.meta?.preTokenBalances ?? []).map((balance) => [
      balance.accountIndex,
      balance,
    ]),
  );
  let escrowIncreaseRaw = 0n;
  for (const post of transaction.meta?.postTokenBalances ?? []) {
    if (post.mint !== SOLANA_USDC_MINT || post.owner !== escrowOwner) continue;
    const pre = preByIndex.get(post.accountIndex);
    const postRaw = BigInt(post.uiTokenAmount?.amount ?? "0");
    const preRaw =
      pre?.mint === SOLANA_USDC_MINT && pre?.owner === escrowOwner
        ? BigInt(pre.uiTokenAmount?.amount ?? "0")
        : 0n;
    if (postRaw > preRaw) escrowIncreaseRaw += postRaw - preRaw;
  }

  return {
    verified: escrowIncreaseRaw >= expectedRawAmount,
    slot: transaction.slot ?? null,
    escrowIncreaseRaw: escrowIncreaseRaw.toString(),
    expectedRaw: expectedRawAmount.toString(),
    officialUsdcMint: SOLANA_USDC_MINT,
  };
}

const response = await fetchJson(`${API_BASE}/bounties`);
const bounties = Array.isArray(response?.bounties) ? response.bounties : [];
const statusCounts = bounties.reduce((counts, bounty) => {
  const status = String(bounty.status ?? "unknown");
  counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}, {});

const now = Date.now();
const openStatuses = new Set(["open", "active", "funded", "accepting_submissions"]);
const excludedPattern =
  /\b(?:twitter|tweet|retweet|discord|telegram|newsletter|followers?|promotion|promote|outreach|tattoo|stake|deposit|bond|entry fee|buy|purchase|pay|private key|seed phrase|kyc)\b/i;

const publicCandidates = bounties
  .filter((bounty) => openStatuses.has(String(bounty.status ?? "")))
  .filter((bounty) => {
    const deadline = Date.parse(bounty.deadline ?? bounty.submissionDeadline ?? "");
    return !Number.isFinite(deadline) || deadline > now;
  })
  .map((bounty) => {
    const rewardRaw = BigInt(bounty.reward?.amount ?? "0");
    const text = `${bounty.title ?? ""}\n${bounty.description ?? ""}`;
    const officialMainnetUsdc =
      bounty.reward?.asset === "USDC" &&
      bounty.reward?.network === SOLANA_MAINNET &&
      rewardRaw > 0n;
    return {
      bounty,
      rewardRaw,
      officialMainnetUsdc,
      sociallyNeutral: !excludedPattern.test(text),
    };
  });

const candidates = [];
for (const item of publicCandidates) {
  const funding = item.officialMainnetUsdc
    ? await verifyFunding(
        item.bounty.fundingTxSig,
        item.bounty.escrowAddress,
        item.rewardRaw,
      )
    : { verified: false, reason: "reward is not positive official Solana-mainnet USDC" };
  candidates.push({
    id: item.bounty.bountyId ?? null,
    title: item.bounty.title ?? null,
    status: item.bounty.status ?? null,
    deadline: item.bounty.deadline ?? item.bounty.submissionDeadline ?? null,
    rewardUsdc: Number(item.rewardRaw) / 1_000_000,
    submissionCount:
      item.bounty.submissions?.length ?? item.bounty.submissionCount ?? null,
    officialMainnetUsdc: item.officialMainnetUsdc,
    sociallyNeutral: item.sociallyNeutral,
    funding,
    noDepositCandidate:
      item.officialMainnetUsdc && item.sociallyNeutral && funding.verified,
  });
}

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      network: "Solana mainnet",
      targetWallet: TARGET,
      publicBountyCount: bounties.length,
      statusCounts,
      openBountyCount: publicCandidates.length,
      candidates,
      noDepositCandidateCount: candidates.filter(
        (candidate) => candidate.noDepositCandidate,
      ).length,
      registrationState: "not-created",
      registrationPolicy:
        "The official onboarding requires operator funding before paid handle registration. Do not spend user funds or register for an empty board; reconsider only after a verified no-deposit candidate appears and an exact-target exit is proven.",
      countingPolicy:
        "Listings, escrow deposits, submissions, reviews, awards, and intermediary-wallet receipts are not goal funds. Count only an independently verified Solana-mainnet receipt at the disclosed target.",
    },
    null,
    2,
  ),
);
