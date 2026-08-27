# BidFit: opportunity qualification and compliance matrices for seller agents

## 1. Product thesis

**BidFit** turns a public U.S. federal solicitation plus a seller's declared capability profile into a conservative bid/no-bid packet and a source-linked requirement/evidence matrix. The buyer is an autonomous seller, subcontracting, capture or opportunity-routing agent that must decide quickly without pretending qualifications it does not have.

The recurring problem is not searching SAM.gov titles. It is extracting deadline, notice type, place, NAICS/PSC, set-aside, mandatory registrations, attachments, deliverables and evaluation requirements, then mapping each to actual seller evidence and explicit gaps. x402 fits per-opportunity decisions: a small firm or agent should buy one qualification packet without an annual competitive-intelligence subscription.

## 2. Buyer workflow and usefulness

- **Trigger:** a new opportunity matches a rough keyword/PSC filter.
- **Action:** reject early, request missing evidence, assign a human, or generate a compliant work plan.
- **Frequency:** 10–1,000 opportunity screens/month; deeper matrix only for finalists.
- **Value:** fewer hours reading poor-fit solicitations and fewer non-responsive bids. KPIs: reviewer agreement, requirement recall, false “eligible” rate and hours saved.

Evidence:

- GSA's public Opportunities API returns published opportunity details, deadlines and attachment links, requires pagination and a personal API key, and updates active notices daily: https://open.gsa.gov/api/get-opportunities-public-api/
- SAM.gov is the public contract-opportunity source: https://sam.gov/opportunities
- USAspending exposes federal award data APIs that can support historical competitor/award context: https://api.usaspending.gov/docs/endpoints
- SAM.gov also publishes Product Service Code data and Contract Awards APIs: https://open.gsa.gov/api/

## 3. Endpoint product

One server-side runtime pins `@lucid-agents/core@5.0.0`, `@lucid-agents/http@4.0.0`, and `@lucid-agents/payments@5.0.0`.

### Paid entrypoint A — `qualify-opportunity`

- **Path/purpose:** `POST /api/agent/entrypoints/qualify-opportunity/invoke`; make an evidence-bounded bid/no-bid recommendation from notice + seller profile.
- **Buyer:** capture/opportunity-routing agent.
- **Request:** `{noticeId, sellerProfile:{services:string[],naics?:string[],psc?:string[],locations?:string[],registrations?:[{name,status,expiresAt}],certifications?:string[],pastPerformanceRefs?:[{id,scope}]}, policy:{minDaysRemaining,maxEstimatedResponseHours?,unknownIsBlocker:boolean}}`
- **Example:** `{"noticeId":"abc123","sellerProfile":{"services":["TypeScript API testing"],"naics":["541511"],"locations":["remote-US"],"registrations":[{"name":"SAM","status":"active","expiresAt":"2027-01-01"}]},"policy":{"minDaysRemaining":7,"unknownIsBlocker":true}}`
- **Response:** `{recommendation:"bid"|"no_bid"|"human_review",score,noticeSnapshot,hardRequirements:[{id,text,sourceRef,status:"met"|"not_met"|"unknown",sellerEvidence}],softFit[],blockers[],questions[],estimatedResponseHours,expiresAt}`
- **Example:** `{"recommendation":"human_review","score":0.64,"hardRequirements":[{"id":"R-7","text":"three similar federal projects","status":"unknown","sellerEvidence":[]}],"blockers":["past-performance evidence missing"]}`
- **Price:** `$0.015 + $0.00002 × attachmentKiB`, max $0.06.
- **SLO/data:** p95 <8 s for ≤2 MiB text; notice snapshot fetched live or age reported; 99.5% target.
- **Dependencies/errors:** SAM adapter, safe attachment extraction, deterministic rule matcher, bounded extraction model. Password/private attachments unsupported. `NOTICE_CHANGED`, `ATTACHMENT_UNREADABLE`, `DEADLINE_PASSED`; unknown cannot become met. Idempotency binds notice/seller/policy hashes.

### Paid entrypoint B — `build-response-evidence-matrix`

- **Path/purpose:** `POST /api/agent/entrypoints/build-response-evidence-matrix/invoke`; produce a complete requirement-to-artifact matrix and verification plan for a human-approved finalist, distinct from qualification.
- **Request:** `{qualificationId, sellerArtifacts:[{artifactId,title,url?,sha256?,claims:string[]}], includeHistoricalAwards:boolean, matrixFormat:"json"|"csv",maxRequirements?:number}`
- **Example:** `{"qualificationId":"bf_123","sellerArtifacts":[{"artifactId":"sample-api","title":"API QA sample","url":"https://github.com/acme/sample","claims":["tested TypeScript API"]}],"includeHistoricalAwards":true,"matrixFormat":"json"}`
- **Response:** `{requirements:[{id,verbatimExcerpt,sourcePage,mandatory,evidenceIds,gap,verification}], complianceSummary, historicalContext?,questionsForContractingOfficer[],artifactManifest,notAProposal:true}`
- **Price:** `$0.07 + $0.002 × requirementCount + $0.02 if historical awards`, cap $0.25/75 requirements.
- **SLO/data:** p95 <45 s; every requirement links to notice/attachment byte/page evidence. Extracted text uncertainty is marked.
- **Dependencies/errors:** stored snapshot, PDF/text extraction, USAspending/SAM awards, retrieval/model with deterministic citation verifier. A missing source page fails that row; no fabricated capability. Same hashes return same matrix.

### Free and shared surfaces

`notice-preview-and-quote` returns notice metadata, attachment inventory, snapshot freshness and exact price but no fit recommendation. The runtime mounts `GET /api/agent/health`, `GET /api/agent/entrypoints`, `POST /api/agent/entrypoints/:key/invoke`, `POST /api/agent/entrypoints/:key/stream`, `/api/agent/.well-known/agent-card.json`, `/api/agent/.well-known/agent.json`, and `/api/agent/.well-known/oasf-record.json`. Paid x402 offers are explicit and fail closed when not configured.

Entities: `NoticeSnapshot`, `Requirement`, `SellerEvidence`, `FitDecision`, `EvidenceMatrix`, `AwardContext`. Seller profile contains assertions, not credentials; no SAM login/API key is accepted from the buyer. Provider uses its licensed public API key server-side and respects limits. Documents are hostile input, isolated from instructions. Non-goals: submitting bids, contacting agencies, certifying eligibility, writing deceptive past performance, legal interpretation, pricing the contract, or accessing controlled attachments.

## 4. x402 payment design

Exact Base USDC. The free quote hashes the latest notice/attachment manifest and size. Payment buys analysis of that immutable snapshot; if SAM reports a material modification before processing, return `NOTICE_CHANGED` and refund/offer a new quote. Duplicate idempotency keys retrieve the packet. If one attachment is unreadable, qualification can proceed only as `human_review`; matrix pricing can exclude it or refund. Results/artifact hashes remain retrievable. Volume bundles are justified for source cache savings, but no seller-specific price discrimination.

## 5. Market analysis

Beachhead: U.S. small software/data-services firms and autonomous seller agents screening public solicitations under $1M. The SAM public API and awards data make an MVP possible without private procurement data.

Alternatives:

1. **SAM.gov search/API** — authoritative opportunities, but no seller-specific evidence matrix.
2. **GovWin IQ** — enterprise government-market intelligence: https://iq.govwin.com/
3. **GovTribe** — opportunity and market intelligence: https://govtribe.com/
4. Manual capture consultants/spreadsheets — high judgment but slow and not transaction-priced.

BidFit's wedge is “show the requirement and the seller evidence; unknown blocks.” Its moat is cited requirement extraction, amendment diffs, seller-evidence reuse and reviewer-correction data. Intelligence vendors can add AI summaries; transparent, no-invention matrices and accountless per-notice buying remain differentiated.

## 6. Unit economics and profitability

Estimated:

| call | revenue | source/extraction/model | storage | gross profit | margin |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 MiB qualification | $0.035 | $0.007 | $0.001 | $0.027 | 77% |
| 35-requirement matrix + history | $0.160 | $0.035 | $0.005 | $0.120 | 75% |

At 85/15 mix:

| calls/month | revenue | variable cost | gross profit |
| ---: | ---: | ---: | ---: |
| 2,000 | $88.50 | $23.80 | $64.70 |
| 20,000 | $885 | $238 | $647 |
| 200,000 | $8,850 | $2,380 | $6,470 |

Assumed fixed API/operations/reviewer QA $1,500/month; break-even ~46,400 calls. Model/extraction cost and attachment size are sensitive. Distribution: x402 directories, public SAM opportunity examples, seller-agent integrations and a free amendment-delta feed.

## 7. Competitive strength

Materially better than a summary: each hard requirement has source evidence and seller evidence or a gap; the service is rewarded for conservative rejection, not bid volume. Positioning begins with software solicitations. Amendment-diff history and human corrections create a defensible corpus. Incumbents can bundle this into subscriptions; BidFit's portable JSON, idempotent snapshot and per-opportunity economics serve low-volume/agent buyers.

## 8. Feasibility and MVP plan

Architecture: Lucid runtime; SAM public adapter; attachment downloader/sandboxed parser/OCR; immutable snapshot store; requirement schema; bounded model; citation verifier; USAspending adapter. Sequence: one notice type → snapshot/amendment diff → qualification rules → paid endpoint → matrix → historical context.

Tests: deadlines/timezones, set-asides, registrations, attachment changes, PDF page citations, unreadable scans, malicious prompt text, unsupported controlled links, seller evidence conflicts, no invented claims, price bounds, idempotency, payment duplicate and all routes. Comply with SAM API key/rate terms and attachment licences. The smallest MVP supports public software solicitations and JSON/text PDFs; all gaps produce human review.

## 9. Copy-paste-ready Taskmarket build brief

**Task title:** Build BidFit Lucid x402 federal opportunity qualification API

**Description:** Build a TypeScript service that snapshots one public SAM.gov solicitation and attachments, maps hard requirements to a declared seller profile, and produces a cited response-evidence matrix without submitting or contacting anyone.

**Stack:** Lucid `core@5.0.0`, `http@4.0.0`, `payments@5.0.0`; TypeScript/Zod, SQL/object storage, sandboxed PDF/text extraction, bounded model and deterministic citation verifier.

**Entrypoints:** paid `qualify-opportunity` with size pricing; paid `build-response-evidence-matrix` with requirement/history pricing; free `notice-preview-and-quote`; all standard Lucid routes.

**Deliverables:** source/lockfile, SAM/USAspending adapters, snapshot/amendment pipeline, schemas, extraction/citation validator, 20 public fixtures, tests, threat/no-fabrication policy, cost benchmark, deployment and preview.

**Acceptance:** every hard requirement source-linked; unknown never met; amendment invalidates quote; seller claims only from supplied artifacts; no submission/contact; Base USDC explicit/fail closed; duplicate-safe.

**Automated verification:** deadline/set-aside/attachment fixtures, amendment race, OCR failure, prompt injection, evidence conflicts, price/idempotency/payment and standard routes.

**Deployment/out of scope:** Node/Cloudflare plus extraction worker and storage. No controlled attachments, bid submission, agency outreach, legal eligibility, proposal authorship or fabricated experience. **Suggested bounty:** 2,100 USDC, 24 days, bounty, public/reveal-on-submit, tags `lucid-agents,x402,procurement,sam-gov,evidence`.

## 10. Sources and assumptions

Verified:

- SAM.gov Opportunities Public API: https://open.gsa.gov/api/get-opportunities-public-api/
- SAM Contract Opportunities: https://sam.gov/opportunities
- USAspending endpoints: https://api.usaspending.gov/docs/endpoints
- GSA public API catalog/PSC/awards: https://open.gsa.gov/api/

Estimates: prices, extraction/model costs, demand, hours saved, margins, fixed cost, latency and break-even. Validate requirement recall/precision with qualified reviewers on at least 100 historical public solicitations. A BidFit output is internal preparation, not a government eligibility ruling or proposal.
