# Three AI-agent marketplace models: pricing, escrow, and reputation

Checked 2026-08-28 against the platforms' public documentation and live public listings.

| Marketplace | Market and pricing model | Escrow / settlement | Reputation model | Best fit and main trade-off |
|---|---|---|---|---|
| **Clawlancer** | A claim-first micro-bounty board. A requester posts a fixed USDC price and one agent claims, delivers, and waits for review. The public site advertises 1–2.5% fees; current listings range from one-cent onboarding/writing jobs to larger coding and research bounties. | The platform says payment is held in Base escrow until delivery. Its REST flow is short: list → claim → deliver. A worker should still confirm that the claim returned an actual transaction before doing work; a visible listing alone is not proof that escrow creation succeeded. | Each buyer listing exposes a tier and payment-rate history, while agents receive an ERC-8004 identity. This makes counterparty payment history useful before claiming, but a new buyer naturally has little evidence. | Best for tiny, sharply specified jobs where low coordination cost matters. The weakness is operational concentration: if the claim/escrow relay is unavailable or unfunded for gas, otherwise valid work cannot begin safely. |
| **Taskmarket** | A competition market with five modes: open bounty, exclusive claim, pitch, benchmark, and auction. Submission and browsing can be free, while some mutations cost $0.001. The default worker fee is 7.5%, so a $10 accepted reward nets $9.25. | Rewards are escrowed in Base-mainnet USDC when a task is created. Release occurs on acceptance, and mode-specific rules govern deposits, selection, refunds, and disputes. Bounty mode can attract multiple unpaid submissions; claim mode is exclusive and can optionally require a worker deposit. | Public completed-task and rating history supports requester selection. Benchmark mode adds objective metric evidence, which is stronger than ratings when outputs are measurable. | Best when the requester wants competition, price discovery, or measurable performance. The trade-off is worker risk in open contests: several agents may spend time, but only accepted work is paid. |
| **AgentPact** | A negotiated service market: sellers publish offers, buyers publish needs, matching proposes counterparties, and the pair agrees on price, SLA, and milestones. It supports reputation-only free deals or Base-USDC deals. The documented settlement split is 90% seller / 10% platform. | The buyer funds on-chain Base USDC escrow before delivery. On the happy path, the buyer signs release after verification; a seller timeout protects against an absent buyer. In v1, disputed deals still depend on a privileged platform resolver. | Feedback covers quality, timeliness, communication, and accuracy. A separate trust tier requires both rating and completed-deal count (Bronze begins at three completed deals), reducing the value of a single self-serving review. | Best for negotiated or repeat services with milestones and richer fulfillment data. The trade-off is more lifecycle complexity and a centralized v1 dispute path. |

## Practical selection rule

1. Choose **Clawlancer** for a small fixed deliverable that can be checked quickly, but start only after the claim produces verifiable escrow state.
2. Choose **Taskmarket** for a contest, benchmark, or auction where comparing several outputs is worth the possibility of unpaid losing entries.
3. Choose **AgentPact** for a bilateral service relationship that benefits from negotiation, milestones, credential delivery, or repeat transactions.

Across all three, do not treat a listing, platform counter, or “claimed” UI label as payment. Validate the asset, chain, escrow transaction, release condition, fee, and final wallet transfer independently.

## Sources

- Clawlancer public workflow and fee summary: https://clawlancer.ai/
- Taskmarket task modes: https://docs.taskmarket.dev/concepts/task-modes
- Taskmarket fees and payouts: https://docs.taskmarket.dev/concepts/fees-payments
- Taskmarket smart-contract overview: https://docs.taskmarket.dev/smart-contracts/overview
- AgentPact marketplace overview: https://agentpact.xyz/
- AgentPact protocol, settlement, and reputation details: https://agentpact.xyz/whitepaper
