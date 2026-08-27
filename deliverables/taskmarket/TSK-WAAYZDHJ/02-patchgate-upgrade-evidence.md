# PatchGate: executable dependency-upgrade evidence

## 1. Product thesis

**PatchGate** sells a bounded answer to a recurring software-agent question: “Will this exact dependency upgrade work in this repository, and what is the smallest safe migration?” The target buyer is a maintenance, security-remediation, or release agent that can identify an available version but cannot risk opening a noisy pull request without repository-specific evidence.

Existing update bots are good at proposing versions. The expensive gap is executing the candidate change in a clean sandbox, interpreting resolution/test/type failures, and returning a reproducible proof bundle. x402 makes the sandbox a per-upgrade transaction: no permanent vendor account, no monthly seat, and price proportional to the test budget.

## 2. Buyer workflow and usefulness

- **Trigger:** a new version or vulnerability fix appears, or a lockfile is stale.
- **Action:** merge a proven lockfile-only upgrade, request a migration plan, or defer with an exact blocker.
- **Frequency:** 5–100 calls/repository/month, bursty after security advisories.
- **Value metric:** percent of proposed upgrades that pass CI on first PR; minutes of maintainer triage avoided; vulnerability exposure time reduced.

Evidence:

- Dependabot raises version/security update PRs and asks maintainers to review changelogs and tests: https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates
- GitHub documents cases where a non-vulnerable version cannot resolve without changing parent dependencies: https://docs.github.com/code-security/dependabot/working-with-dependabot/troubleshooting-dependabot-errors
- OSV supports version- and commit-specific vulnerability queries, including batch requests: https://google.github.io/osv.dev/api/
- SPDX provides stable machine-readable licence identifiers and matching guidance: https://spdx.dev/learn/handling-license-info/

## 3. Endpoint product

One server-side runtime pins `@lucid-agents/core@5.0.0`, `@lucid-agents/http@4.0.0`, and `@lucid-agents/payments@5.0.0`.

### Paid entrypoint A — `test-upgrade-candidate`

- **Path/job/buyer:** `POST /api/agent/entrypoints/test-upgrade-candidate/invoke`; execute one exact version change for a public repo or uploaded source archive; bought by update/security agents.
- **Request:** `{source:{repoUrl,commitSha}|{archiveUrl,sha256}, ecosystem:"npm"|"pypi", package, fromVersion, toVersion, commands:string[], limits:{cpuSeconds<=600,memoryMb<=4096,network:"registry-only"|"none"}}`
- **Example:** `{"source":{"repoUrl":"https://github.com/acme/widget","commitSha":"abcdef0123456789abcdef0123456789abcdef01"},"ecosystem":"npm","package":"zod","fromVersion":"3.23.8","toVersion":"4.0.0","commands":["npm ci","npm test","npm run typecheck"],"limits":{"cpuSeconds":300,"memoryMb":2048,"network":"registry-only"}}`
- **Response:** `{verdict, sourceHash, lockfileDiff, commandResults:[{exitCode,durationMs,stdoutTailHash,stderrTailHash}], vulnerabilitiesBeforeAfter, licenceDelta, artifactUrl, expiresAt}`. Example verdict: `{"verdict":"blocked","lockfileDiff":{"added":3,"removed":2},"commandResults":[{"exitCode":2,"stderrTailHash":"sha256:1111111111111111111111111111111111111111111111111111111111111111"}],"vulnerabilitiesBeforeAfter":{"before":1,"after":0},"licenceDelta":[],"artifactUrl":"https://evidence.example/proofs/patchgate-run-123"}`.
- **Price:** deterministic `$0.02 + $0.00004 × requestedCpuSeconds`, bounded $0.024–$0.044, Base USDC.
- **SLO:** queue start p95 <15 s; result within requested budget; registry metadata ≤15 minutes old; 99% control-plane availability.
- **Dependencies:** isolated Firecracker/container runner, registry, OSV, SPDX, Git source. Errors include `UNBUILDABLE_BASELINE`, `SOURCE_HASH_MISMATCH`, `LIMIT_EXCEEDED`; retry only infrastructure errors. Request hash/idempotency key prevents double execution and charge.

### Paid entrypoint B — `plan-minimal-migration`

- **Path/job:** `POST /api/agent/entrypoints/plan-minimal-migration/invoke`; turn a failed proof into a ranked, patch-shaped migration plan, a meaningfully different diagnostic/design task.
- **Request:** `{proofId, allowedFiles:string[], maxChangedLines:number, compatibilityTarget:string, requirePassingCommands:string[]}`
- **Example:** `{"proofId":"pg_123","allowedFiles":["src/**","package*.json"],"maxChangedLines":80,"compatibilityTarget":"node>=20","requirePassingCommands":["npm test","npm run typecheck"]}`
- **Response:** `{plan:[{file,hunks,rationale,sourceLinks}], proposedPatch, validation:{commands,expected}, unresolved[], confidence}`; patch is data, never pushed.
- **Price:** $0.08 for ≤80 changed lines; $0.001 per additional allowed line, max $0.20.
- **SLO/dependencies:** p95 <90 s; uses proof artifacts, release notes, repository search, bounded code model. Model output must be validated by a second sandbox run; otherwise `verdict:"unverified"`. Same proof+policy hash is idempotent.

### Free and safety surfaces

`quote-upgrade-run` returns price, required inputs, supported ecosystems, and expected cache hit. The runtime mounts `GET /api/agent/health`, `GET /api/agent/entrypoints`, `POST /api/agent/entrypoints/:key/invoke`, `POST /api/agent/entrypoints/:key/stream`, `/api/agent/.well-known/agent-card.json`, `/api/agent/.well-known/agent.json`, and `/api/agent/.well-known/oasf-record.json`. Paid offers are explicit and fail closed when payment config is absent.

Entities: `SourceSnapshot`, `UpgradeCandidate`, `Run`, `Proof`, `MigrationPlan`. Public repositories or buyer-authorized archives only; no credentials in source URLs; egress allowlist; no postinstall network except explicitly selected registry; CPU/memory/disk/output caps; malware detection; secrets redaction. Non-goals: merging, publishing packages, claiming complete security, or executing production credentials.

## 4. x402 payment design

Exact Base USDC settlement. `quote-upgrade-run` signs a quote hash containing source SHA, commands, limits, price, and 10-minute expiry. Payment buys that immutable budget. Invocation must carry quote and idempotency keys; duplicates retrieve the same proof. A price-affecting change requires a new quote. If the runner never starts, auto-refund; if buyer code times out after consuming the paid budget, return partial logs and usage rather than refund. Result retrieval is free for 24 hours. Bundled prepaid credits are optional but no subscription is required. Price varies only by declared compute/patch bounds, not buyer identity.

## 5. Market analysis

Beachhead: public npm/TypeScript repositories whose Dependabot PRs fail tests or need a major-version migration. Per-call payment fits open-source maintainers and agents that cannot justify a seat licence.

Alternatives:

1. **Dependabot** proposes updates in GitHub but does not sell a portable pre-PR sandbox proof.
2. **Renovate** automates dependency PRs and grouping; repository owners still operate CI and triage failures: https://docs.renovatebot.com/
3. **Snyk Open Source** identifies and prioritizes dependency risk; it is a broader platform rather than a neutral per-upgrade execution receipt: https://docs.snyk.io/scan-with-snyk/snyk-open-source
4. Existing CI can test the change, but first requires modifying a branch and consumes owner capacity.

The wedge is content-addressed, buyer-independent evidence before a PR. Timing is supported by mature OSV/SPDX machine data and x402 micropayments. A growing corpus of failure signatures, migration patches, and package-specific test fixtures creates a defensible feedback loop. Git hosts could add preflight execution; PatchGate remains portable across hosts and purchasable by any agent.

## 6. Unit economics and profitability

Estimates for representative calls:

| Product | revenue | sandbox/model | metadata/storage | gross profit | margin |
| --- | ---: | ---: | ---: | ---: | ---: |
| 300-second test | $0.032 | $0.0060 | $0.0010 | $0.0250 | 78% |
| 80-line migration | $0.080 | $0.0180 | $0.0020 | $0.0600 | 75% |

Assume 80/20 mix:

| calls/month | revenue | variable cost | gross profit |
| ---: | ---: | ---: | ---: |
| 2,000 | $83.20 | $19.20 | $64.00 |
| 20,000 | $832 | $192 | $640 |
| 200,000 | $8,320 | $1,920 | $6,400 |

At estimated fixed runner/control-plane cost of $350/month, break-even is ~10,940 mixed calls. Profit is most sensitive to sandbox duration and model validation. Acquisition: x402 directories, a free GitHub Check integration that links to paid proof, OSV remediation examples, and Taskmarket build tasks.

## 7. Competitive strength

PatchGate is materially better for an autonomous buyer because the output is an executable receipt tied to immutable source and exact commands, not a generic version recommendation. The first wedge is “test before opening the PR.” Moats: cached content-addressed environments, failure-to-fix pairs, ecosystem-specific migration tests, and reproducible evidence URLs. Competitors may add stronger CI; differentiation survives through cross-host portability, sub-minute purchasing, and neutral evidence that the buyer can attach anywhere.

## 8. Feasibility and MVP plan

MVP architecture: Lucid HTTP/payment runtime; quote service; queue; rootless ephemeral runners; npm-only dependency editor; OSV/SPDX clients; object storage for redacted logs; Postgres for idempotency/usage. Sequence: fixture repositories → baseline and upgraded runs → proof schema → paid test endpoint → migration endpoint with validation → observability and quotas.

Tests: Zod contracts, quote arithmetic, lockfile mutation, baseline failure, malicious lifecycle scripts, egress denial, timeout/OOM, OSV pagination, SPDX deltas, redaction, payment absent/duplicate, retrieval after timeout, and deterministic fixture hashes. Licence and upstream terms must permit metadata reuse; public source licences are preserved. Biggest risks are untrusted code execution and runaway compute, mitigated by microVM isolation, no privileged mounts, strict egress and limits. MVP excludes private repos and non-npm ecosystems.

## 9. Copy-paste-ready Taskmarket build brief

**Task title:** Build PatchGate npm upgrade proof service with Lucid Agents and x402

**Description:** Build a TypeScript service that runs an exact npm dependency upgrade in a rootless isolated runner, returns content-addressed command/lockfile/OSV/SPDX evidence, and can produce a bounded migration patch that is revalidated in the same sandbox.

**Stack:** exact Lucid packages `core@5.0.0`, `http@4.0.0`, `payments@5.0.0`; TypeScript, Zod, Postgres, S3-compatible storage, rootless container/microVM queue.

**Entrypoints:** paid `test-upgrade-candidate` using the compute price rule; paid `plan-minimal-migration` at $0.08 base; free `quote-upgrade-run`; all standard Lucid discovery/invocation records and stream route.

**Deliverables:** source/lockfile, runner images, schemas, quote/payment/idempotency logic, npm mutator, OSV/SPDX clients, redacted proof artifacts, at least six fixture repos, tests, threat model, cost benchmark, deployment IaC, public preview.

**Acceptance:** immutable source hash; baseline and upgraded commands; fail-closed egress; exact price calculation; validated patch or `unverified`; no secret leakage; explicit Base USDC offers; missing payment config never opens paid handlers.

**Automated verification:** malicious-package fixtures, timeout/OOM, network denial, known-vulnerability delta, licence change, payment duplicate, idempotency conflict, route smoke tests, typecheck/lint/tests, and proof-hash replay.

**Deployment/out of scope:** Node control plane plus isolated runners; public demo on allowlisted repositories. No private repo credentials, merge/publish actions, production secrets, or security guarantee. **Suggested bounty:** 2,500 USDC, 28 days, bounty, public/reveal-on-submit, tags `lucid-agents,x402,devtools,supply-chain,sandbox`.

## 10. Sources and assumptions

Verified:

- Dependabot version updates: https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates
- Dependabot resolution failures: https://docs.github.com/code-security/dependabot/working-with-dependabot/troubleshooting-dependabot-errors
- OSV API and no current API rate limit: https://google.github.io/osv.dev/api/
- SPDX licence identifiers: https://spdx.dev/learn/handling-license-info/
- GitHub compare endpoint for source diffs: https://docs.github.com/en/rest/commits/commits#compare-two-commits

Estimates: prices, runner/model costs, usage, fixed cost, margins, latency, and break-even. Validate them with 500 metered public-repo runs. A passing proof covers only the declared commands/environment and is not proof of production correctness or legal compliance.
