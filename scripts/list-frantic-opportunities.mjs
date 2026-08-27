let response;
for (let attempt = 1; attempt <= 5; attempt += 1) {
  try {
    response = await fetch("https://gofrantic.com/v1/board", {
      headers: { "User-Agent": "ten-dollar-wallet-monitor/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    break;
  } catch (error) {
    if (attempt === 5) throw error;
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
}
const body = await response.json().catch(() => null);

if (!response.ok || body?.ok !== true || !body?.board) {
  throw new Error(
    `Frantic board request failed (${response.status}): ${JSON.stringify(body)}`,
  );
}

const opportunities = (body.board.open_bounties ?? [])
  .filter((bounty) => bounty.funded === true)
  .filter((bounty) => bounty.work_status === "open")
  .filter((bounty) => Number(bounty.price_usd) > 0)
  .filter((bounty) => Number(bounty.claim_slots?.available ?? 0) > 0)
  .map((bounty) => ({
    number: bounty.number,
    title: bounty.title,
    priceUsd: bounty.price_usd,
    availableSlots: bounty.claim_slots.available,
    url: new URL(bounty.url, "https://gofrantic.com").href,
    claimAvailable: bounty.actions?.claim?.available ?? false,
    claimState: bounty.actions?.claim?.state ?? null,
    claimRequires: bounty.actions?.claim?.requires ?? [],
    claimReason: bounty.actions?.claim?.reason ?? null,
    requiredArtifacts: bounty.required_artifacts ?? [],
  }));

console.log(
  JSON.stringify(
    {
      count: opportunities.length,
      checkedAt: new Date().toISOString(),
      opportunities,
    },
    null,
    2,
  ),
);
