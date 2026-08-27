# EscrowProof: eligible-job evidence for autonomous workers

## 1. Product thesis

**EscrowProof** turns fragmented bounty listings into a transaction-ready answer: “which jobs can this agent safely do now, and what proves the reward and payout route?” The buyer is an autonomous worker, treasury bot, or operator that cannot spend principal funds, fabricate identity, or discover after hours of work that a reward was never escrowed.

The recurring problem is not finding pages containing the word “bounty.” It is normalizing reward, net fee, escrow transaction, stake, upfront payment, identity/social requirements, deadline, submission mode, and external-withdrawal capability across incompatible boards. x402 fits because the worker needs an answer at a decision point, may have no account with the seller, and should pay only for a fresh evidence packet—not subscribe to every source.

## 2. Buyer workflow and usefulness

- **Trigger:** a worker becomes idle or a monitor wakes on schedule.
- **Action enabled:** select a job whose economics and constraints are proven, or reject it with a machine-readable reason.
- **Frequency:** 4–72 discovery calls per day and one verification call immediately before claim/submission.
- **Measurable value:** fewer hours spent reading ineligible prose; fewer failed claims; no accidental deposit, stake, paid bid, social manipulation, or unverifiable-reward work.

Evidence that the problem exists:

- Taskmarket exposes structured fields including public tasks and worker actions, but it is one market: https://docs.taskmarket.dev/api/reference
- GitHub bounty-like work is represented as ordinary issues, whose labels and bodies are repository-defined rather than escrow proofs: https://docs.github.com/en/rest/issues/issues
- x402 directories already demonstrate that agents will buy individual search/routing answers without API keys: https://x402dash.com/developers/

Verified fact: each source has its own contract. Estimate: a worker avoiding one 30-minute false lead at a $6/hour opportunity cost saves $3.

## 3. Endpoint product

One server-only Lucid runtime uses `@lucid-agents/core@5.0.0`, `@lucid-agents/http@4.0.0`, and `@lucid-agents/payments@5.0.0`.

### Paid entrypoint A — `find-eligible-jobs`

- **Path:** `POST /api/agent/entrypoints/find-eligible-jobs/invoke`
- **Purpose/buyer:** rank currently funded work for a worker policy.
- **Request schema:** `{ networks:string[], minNetUsd:number, maxNetUsd?:number, constraints:{stake:boolean,upfrontPayment:boolean,principalSignature:boolean,kyc:boolean,socialAction:boolean,externalWithdrawal:boolean}, skills?:string[], limit:1..50 }`
- **Example request:** `{"networks":["base"],"minNetUsd":1,"constraints":{"stake":false,"upfrontPayment":false,"principalSignature":false,"kyc":false,"socialAction":false,"externalWithdrawal":true},"skills":["typescript","research"],"limit":10}`
- **Response schema:** `{checkedAt, policyHash, jobs:[{source,sourceTaskId,url,title,deadline,netRewardUsd,rewardAsset,escrow,requirements,payout,evidenceUrls,confidence,unknowns}],excludedCounts,nextCursor?}`
- **Example response:** `{"checkedAt":"2026-08-27T16:00:00Z","policyHash":"sha256:1111111111111111111111111111111111111111111111111111111111111111","jobs":[{"source":"taskmarket","sourceTaskId":"0x1111111111111111111111111111111111111111111111111111111111111111","netRewardUsd":2.775,"rewardAsset":"USDC","escrow":{"verified":true,"network":"base","txHash":"0x2222222222222222222222222222222222222222222222222222222222222222"},"requirements":{"stakeUsd":0,"upfrontPaymentUsd":0,"kyc":false,"socialAction":false},"payout":{"externalWithdrawal":true,"network":"base"},"confidence":0.96,"unknowns":[]}],"excludedCounts":{"unfunded":12,"requiresMoney":4,"unknownPayout":7}}`
- **Price:** $0.006 USDC, Base mainnet.
- **SLO/data:** p95 under 2.5 s from a snapshot no older than 10 minutes; 99.5% monthly availability target.
- **Dependencies:** official board APIs, GitHub public issues, Base RPC/explorer, deterministic policy engine, cached source snapshots.
- **Errors:** `NO_FRESH_SOURCES` (503), `POLICY_UNSUPPORTED` (422), partial results with `unknowns`; retry only 429/503 with jitter. Same `Idempotency-Key` and body returns the same snapshot and charge result for 10 minutes.

### Paid entrypoint B — `verify-job-payment-path`

- **Path:** `POST /api/agent/entrypoints/verify-job-payment-path/invoke`
- **Purpose/buyer:** revalidate one job immediately before a claim or submission; this is a different job from discovery.
- **Request schema:** `{source:string, taskId:string, intendedPayout:{network:string,asset:string,externalAddress?:string}, requireEscrow:boolean}`
- **Example request:** `{"source":"taskmarket","taskId":"0xabc","intendedPayout":{"network":"base","asset":"USDC"},"requireEscrow":true}`
- **Response schema:** `{verdict:"eligible"|"ineligible"|"unknown", checkedAt, reward, escrow:{status,chain,txHash,amount,confirmations}, payout:{route,addressMatch?,fees}, blockers[], evidence[]}`
- **Example response:** `{"verdict":"eligible","checkedAt":"2026-08-27T16:01:00Z","reward":{"grossUsd":3,"netUsd":2.775},"escrow":{"status":"confirmed","chain":"base","txHash":"0x2222222222222222222222222222222222222222222222222222222222222222","amount":3,"confirmations":220},"payout":{"route":"platform-withdrawal","feesUsd":0.225},"blockers":[],"evidence":[{"url":"https://evidence.example/transactions/22222222","sha256":"3333333333333333333333333333333333333333333333333333333333333333"}]}`
- **Price:** $0.003 USDC, Base mainnet.
- **SLO/data:** p95 under 4 s; chain evidence at the reported block; source record fetched live where available.
- **Dependencies/errors:** board detail API plus chain RPC. A timeout is `unknown`, never eligible. A reused idempotency key does not re-charge.

### Free and shared surfaces

`preview-sources` returns coverage/freshness but no ranked jobs. The runtime also mounts `GET /api/agent/health`, `GET /api/agent/entrypoints`, `POST /api/agent/entrypoints/:key/invoke`, `POST /api/agent/entrypoints/:key/stream`, `/api/agent/.well-known/agent-card.json`, `/api/agent/.well-known/agent.json`, and `/api/agent/.well-known/oasf-record.json`. Paid entries advertise explicit x402 offers when configured and return a typed payment-configuration error when not; they never become free.

Shared entities are `SourceSnapshot`, `Job`, `EscrowEvidence`, `Constraint`, `PayoutRoute`, and `EligibilityVerdict`. No wallet private key, KYC document, unpublished listing, or marketplace credential is accepted. Addresses are optional and redacted from logs. Rate limits, URL allowlists, response-size caps, and HTML-to-text isolation reduce SSRF and prompt-injection risk. Non-goals: claiming jobs, submitting work, giving legal eligibility opinions, or guaranteeing a marketplace will choose a worker.

## 4. x402 payment design

Both endpoints settle exact Base USDC (`eip155:8453`, official USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`). Discovery is more expensive because it joins multiple snapshots; verification is cheaper and narrow. Free discovery exposes schemas, prices, supported sources, snapshot timestamps, and example redacted output.

Flow: discover entrypoint → receive explicit offer → sign exact payment → invoke with `Idempotency-Key` → facilitator settles → return evidence. The server stores payment ID, body hash, snapshot ID, and result hash. A duplicate with the same tuple returns the cached result; a changed body with the same key returns 409. If settlement succeeds but processing times out, the buyer can retrieve the result by idempotency key for 24 hours. A source-wide failure before work begins is refundable or converted to a credit; partial-source results are returned only when the request opted into `allowPartial=true`. Bundles of 1,000 calls may discount 20%; no identity-based price discrimination.

## 5. Market analysis

Beachhead: autonomous coding/research workers that already poll Taskmarket, GitHub, and crypto-native boards. Demand is demonstrated by structured worker actions in Taskmarket and by the current proliferation of separate job feeds. Market timing improves as x402 makes sub-cent routing economical and agent wallets can pay without provisioning API keys.

Competitors/substitutes:

1. **Taskmarket** — strong escrow/task lifecycle for its own market, not cross-market normalization.
2. **Superteam Earn** — curated opportunities, but a worker still evaluates that marketplace's rules separately.
3. **GitHub Issues/search** — broad reach, but labels are not proof of escrow or external payout.
4. Manual spreadsheets/agent prompts — flexible but stale and unauditable.

The wedge is a conservative verdict backed by field-level evidence and chain proofs. A cross-source historical corpus can improve rule extraction, source reliability scoring, and false-positive feedback. Boards can respond by standardizing manifests; EscrowProof remains differentiated through cross-board joins and independent re-verification.

## 6. Unit economics and profitability

Estimated variable costs, not observed production figures:

| Call | Revenue | source/RPC | compute/storage | gross profit | margin |
| --- | ---: | ---: | ---: | ---: | ---: |
| discovery | $0.0060 | $0.0005 | $0.0007 | $0.0048 | 80% |
| verification | $0.0030 | $0.0004 | $0.0003 | $0.0023 | 77% |

Monthly scenarios use a 70/30 discovery/verification mix:

| Scenario | calls | revenue | variable cost | gross profit |
| --- | ---: | ---: | ---: | ---: |
| low | 10,000 | $51 | $10.2 | $40.8 |
| base | 100,000 | $510 | $102 | $408 |
| high | 1,000,000 | $5,100 | $1,020 | $4,080 |

Assumed fixed infrastructure is $120/month; break-even is about 29,500 mixed calls. Profit is most sensitive to paid upstream licences and snapshot refresh frequency. Distribution: x402dash/x402.direct listings, Taskmarket worker examples, open-source policy schema, and a free coverage/status endpoint.

## 7. Competitive strength

Unlike a jobs search, the product answers a policy decision and cites every material field. Its initial positioning is “fail closed before you work.” The moat is not an LLM summary; it is source adapters, observed schema drift, normalized historical outcomes, chain evidence, and a corpus of exclusion rules with regression fixtures. Likely responses are board-specific eligibility flags and aggregators. EscrowProof stays useful by remaining marketplace-neutral, publishing provenance hashes, and measuring whether supposedly executable payment paths actually settle.

## 8. Feasibility and MVP plan

Architecture: Cloudflare Worker/Node-compatible Lucid runtime; scheduled source collectors; D1/Postgres snapshots; Base RPC; deterministic JSON-schema validators; optional bounded model only for extracting candidate fields from prose, never for final eligibility. Provenance stores canonical URL, fetched time, ETag/body hash, parser version, block number, and field evidence.

Sequence: (1) Taskmarket + GitHub adapters; (2) policy schema and fail-closed verifier; (3) Base escrow proof; (4) two paid handlers and free preview; (5) add one board only after fixtures cover drift; (6) metrics and dispute audit export. Tests cover Zod schemas, policy truth tables, malicious listing text, stale sources, chain reorg/timeout, amount/unit conversion, idempotency, payment missing/duplicate, and cost assumptions. MVP is useful with two sources and explicit `unknown` fields.

Risks: board terms and rate limits, misclassified prose, delisted tasks, and chain/provider outage. Respect robots/API terms, cache conservatively, never bypass auth, and label an inference as an inference. No legal guarantee or identity determination.

## 9. Copy-paste-ready Taskmarket build brief

**Task title:** Build EscrowProof, a paid Lucid eligible-job evidence router

**Description:** Implement a production-ready TypeScript service that joins Taskmarket public tasks and public GitHub bounty-like issues into conservative, source-linked eligibility records. It must verify Taskmarket escrow transactions on Base and never treat missing data as eligible.

**Required stack:** `@lucid-agents/core@5.0.0`, `@lucid-agents/http@4.0.0`, `@lucid-agents/payments@5.0.0`, TypeScript, Zod, durable SQL/KV storage, Base RPC. One server-side Lucid runtime only.

**Entrypoints:** paid `find-eligible-jobs` ($0.006) and `verify-job-payment-path` ($0.003); free `preview-sources`. Mount all standard health, entrypoint, invoke/stream, agent-card, agent, and OASF routes.

**Deliverables:** source, lockfile, schemas, two adapters, chain verifier, fixture snapshots, migrations, unit/integration tests, OpenAPI/examples, threat model, cost worksheet, deployment configuration, and public preview.

**Acceptance criteria:** exact schemas above; field-level evidence; stale/timeout becomes `unknown`; filters enforce all constraints; explicit Base USDC offers; paid handlers fail closed without payment config; same idempotency key never double-charges; no secret/address leakage; p95 fixture benchmark under 2.5 s discovery and 4 s verification.

**Automated verification:** pinned fixture hashes, policy truth-table tests, Base RPC mock/reorg tests, SSRF and hostile-prose tests, payment absent/valid/duplicate tests, TypeScript/lint/build, and a smoke test of every standard Lucid route.

**Deployment:** Cloudflare Workers or Node container with managed Postgres/D1; public preview required. **Out of scope:** claiming/submitting jobs, KYC, private boards, legal advice, wallet custody. **Suggested bounty:** 1,200 USDC, 21 days, `bounty`, public task/reveal-on-submit, tags `lucid-agents,x402,bounties,provenance,base`.

## 10. Sources and assumptions

Verified sources:

- Taskmarket API reference: https://docs.taskmarket.dev/api/reference
- GitHub Issues REST API: https://docs.github.com/en/rest/issues/issues
- x402dash public discovery and paid routing prices: https://x402dash.com/developers/
- Base USDC contract listing: https://www.circle.com/multi-chain-usdc/base

Assumptions/estimates: call frequency, opportunity cost, source/RPC costs, margins, infrastructure, and demand scenarios are planning estimates requiring a two-week metered pilot. The product does not assert that a structured escrow record guarantees selection or payment; it proves only the evidence available at the reported time.
