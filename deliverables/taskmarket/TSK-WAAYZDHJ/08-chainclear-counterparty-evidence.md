# ChainClear: counterparty screening with ownership evidence

## 1. Product thesis

**ChainClear** gives a procurement, payment or marketplace agent a time-stamped counterparty evidence packet before it awards work or sends funds. It joins official sanctions/exclusions lists, entity identifiers, aliases and disclosed parent relationships; returns possible matches with explainable fields; and refuses to turn fuzzy similarity into legal clearance.

The buyer is an autonomous accounts-payable, supplier-onboarding, grant, trade or agent-marketplace workflow. The recurring problem is resolving one real-world organization across lists at the exact decision time. x402 fits occasional, cross-organization checks: buy one screening or one enhanced ownership packet without sending a whole vendor database to a subscription platform.

## 2. Buyer workflow and usefulness

- **Trigger:** before vendor onboarding, award, payout, renewal or changed-list recheck.
- **Action:** proceed under policy, block a deterministic exact match, or escalate a possible match to a qualified human.
- **Frequency:** one standard screen per transaction/counterparty plus event-driven rechecks.
- **Value:** lower manual search time and a complete audit trail. KPIs: false-positive escalation rate, list freshness, entity resolution coverage and decision-to-evidence latency.

Evidence:

- OFAC's Sanctions List Service supplies up-to-date downloadable SDN and consolidated non-SDN data and a fuzzy search tool: https://ofac.treasury.gov/sanctions-list-service
- OFAC publishes hashes for list files so consumers can verify content integrity: https://ofac.treasury.gov/specially-designated-nationals-list-sdn-list/hash-values-for-ofac-sanctions-list-files
- SAM.gov offers Entity, Exclusions and Responsibility/Qualification APIs/data services: https://sam.gov/entity-information
- GLEIF relationship records can represent direct and ultimate parents and reporting exceptions: https://www.gleif.org/en/lei-data/access-and-use-lei-data/level-2-data-who-owns-whom

## 3. Endpoint product

One server-side runtime pins `@lucid-agents/core@5.0.0`, `@lucid-agents/http@4.0.0`, and `@lucid-agents/payments@5.0.0`.

### Paid entrypoint A — `screen-counterparty`

- **Path/purpose:** `POST /api/agent/entrypoints/screen-counterparty/invoke`; screen one person/organization/vessel against selected official datasets.
- **Buyer:** onboarding/payment/procurement agent.
- **Request:** `{subject:{type:"organization"|"person"|"vessel",name,country?,registrationId?,lei?,addresses?:string[],dateOfBirth?},lists:["OFAC","SAM_EXCLUSIONS","ITA_CSL"],threshold?:number,asOf?}`
- **Example:** `{"subject":{"type":"organization","name":"Example Industrial LLC","country":"US","lei":null},"lists":["OFAC","SAM_EXCLUSIONS","ITA_CSL"],"threshold":0.82}`
- **Response:** `{verdict:"no_match"|"possible_match"|"deterministic_match"|"unknown",checkedAt,datasetManifest,matches:[{list,recordId,score,matchedFields,unmatchedFields,programs,restrictions,sourceUrl,sourceHash}],warnings,nextReviewAt}`
- **Example:** `{"verdict":"possible_match","matches":[{"list":"OFAC","recordId":"12345","score":0.87,"matchedFields":["normalizedName"],"unmatchedFields":["country"],"sourceUrl":"https://sanctionssearch.ofac.treas.gov/"}],"warnings":["name-only match; human review required"]}`
- **Price:** `$0.008 + $0.004 × listCount`, max $0.024; Base USDC.
- **SLO/data:** p95 <1.5 s; list ages/hashes explicit; update checks at least hourly where sources do; 99.9% target.
- **Dependencies/errors:** signed/hashed official list snapshots, deterministic normalization, configurable fuzzy matcher. A source outage makes selected-list coverage `unknown`, not `no_match`. Same subject/list/snapshot hash is idempotent.

### Paid entrypoint B — `trace-ownership-and-rescreen`

- **Path/purpose:** `POST /api/agent/entrypoints/trace-ownership-and-rescreen/invoke`; resolve disclosed parent chains and screen each node, a different enhanced-diligence job.
- **Request:** `{subject:{lei?,name,country?},maxDepth:1..4,includeReportingExceptions:boolean,lists:string[],ownershipPolicy?:{aggregateThresholdPct?:number}}`
- **Example:** `{"subject":{"lei":null,"name":"Example Subsidiary"},"maxDepth":3,"includeReportingExceptions":true,"lists":["OFAC","ITA_CSL"],"ownershipPolicy":{"aggregateThresholdPct":50}}`
- **Response:** `{graph:{nodes:[{id,name,lei,relationshipStatus,percentKnown?}],edges:[{type,source,target,evidence}]},screenings[],exceptions[],unresolvedParents[],policyObservations[],notLegalConclusion:true}`
- **Price:** `$0.04 + $0.01 × resolvedParentNode`, max $0.12.
- **SLO/data:** p95 <4 s for 10 nodes; GLEIF timestamp and relationship status preserved. Missing/disclosed-exception parent data remains explicit.
- **Dependencies/errors:** GLEIF API/data, official lists and graph resolver. No inferred ownership percentage. Cycle/depth/ambiguity errors are typed; idempotency binds graph snapshot.

### Free and shared surfaces

`dataset-status` exposes list names, publication times, verified hashes, coverage and price. The runtime mounts `GET /api/agent/health`, `GET /api/agent/entrypoints`, `POST /api/agent/entrypoints/:key/invoke`, `POST /api/agent/entrypoints/:key/stream`, `/api/agent/.well-known/agent-card.json`, `/api/agent/.well-known/agent.json`, and `/api/agent/.well-known/oasf-record.json`. Paid entries show explicit x402 offers and fail closed when payment config is absent.

Entities: `Subject`, `ListSnapshot`, `SanctionsRecord`, `MatchEvidence`, `LegalEntity`, `Relationship`, `Screening`. Personal data is minimized; DOB only when buyer is authorized, encrypted and short-lived. Never publish query histories. Rate-limit enumeration and vessel/person bulk scraping. Non-goals: legal advice, definitive clearance, beneficial-owner invention, KYC document verification, filing reports, or automatically blocking on fuzzy name alone.

## 4. x402 payment design

Exact Base USDC. Free discovery hashes current list manifests; a paid response binds those hashes. Duplicate key/request returns the same evidence without another charge. If a required list cannot be verified before matching, refund or return partial only with prior buyer consent and per-list coverage. A new list publication intentionally creates a new chargeable snapshot; an event subscription/bundle can discount rechecks. Price depends on sources/nodes, never nationality or match outcome. Results are retrievable by signed receipt while sensitive request data expires.

## 5. Market analysis

Beachhead: autonomous B2B marketplaces and small procurement agents needing auditable U.S.-list screening at payout time. Official sources exist, but resolution and evidence assembly remain buyer work.

Alternatives:

1. **OFAC Sanctions List Search/SLS** — authoritative U.S. data/search, not a multi-source transaction packet.
2. **OpenSanctions** — open/commercial entity and sanctions datasets/API: https://www.opensanctions.org/
3. **LSEG World-Check** — enterprise screening/risk intelligence: https://www.lseg.com/en/risk-intelligence/screening/world-check
4. **Dow Jones Risk & Compliance** — enterprise due-diligence platform: https://www.dowjones.com/professional/risk/

ChainClear's wedge is a small, source-hashed, accountless check designed for machine decisions while preserving `unknown`. Moat: alias/identifier resolution, historical list-delta tests, parent-graph handling and measured false positives. Enterprise vendors can expose APIs; transparent low-volume pricing and official-source receipts remain distinct.

## 6. Unit economics and profitability

Estimated:

| call | revenue | data/compute | storage/review reserve | gross profit | margin |
| --- | ---: | ---: | ---: | ---: | ---: |
| 3-list screen | $0.020 | $0.0020 | $0.0010 | $0.0170 | 85% |
| 4-node enhanced | $0.080 | $0.0180 | $0.0040 | $0.0580 | 73% |

At 90/10 mix:

| calls/month | revenue | variable cost | gross profit |
| ---: | ---: | ---: | ---: |
| 10,000 | $260 | $49 | $211 |
| 100,000 | $2,600 | $490 | $2,110 |
| 1,000,000 | $26,000 | $4,900 | $21,100 |

Assumed fixed licensing/security/compliance operations $3,000/month; break-even ~142,200 calls. Licensed non-official data and human QA are sensitive. Distribution: procurement/payment-agent SDKs, x402 catalogs, a free signed list manifest and audit-system exporters.

## 7. Competitive strength

Material advantage: every match explains both matched and conflicting fields and every no-match states which snapshots were actually checked. Positioning is “evidence, not clearance.” The moat is reproducible entity resolution plus correction feedback. Incumbents may offer cheaper API calls; ChainClear can remain neutral, content-addressed and usable without long procurement.

## 8. Feasibility and MVP plan

MVP architecture: Lucid runtime; hourly OFAC/ITA and daily SAM collectors; file-hash verifier; normalized Postgres index; GLEIF adapter; deterministic scoring; encrypted request store; signed result manifest. Start with organizations only and no DOB.

Tests: exact identifiers, aliases/transliteration, conflicting countries, name-only false positives, list update/delta/withdrawal, hash failure, source outage, GLEIF relationship exceptions/cycles, depth caps, sensitive logging, idempotency, payment duplicates and standard routes. Preserve official disclaimers and licence terms. Qualified compliance counsel must review matching policy. MVP never says “approved” and never makes a payment decision itself.

## 9. Copy-paste-ready Taskmarket build brief

**Task title:** Build ChainClear Lucid x402 official-list counterparty evidence API

**Description:** Build a TypeScript organization-screening service using OFAC, ITA consolidated screening and SAM exclusions snapshots, plus optional GLEIF parent tracing. Return explainable matches and signed source manifests; missing source coverage must be unknown.

**Stack:** Lucid `core@5.0.0`, `http@4.0.0`, `payments@5.0.0`; TypeScript/Zod, Postgres, scheduled collectors, JWS signer.

**Entrypoints:** paid `screen-counterparty` with list-count pricing; paid `trace-ownership-and-rescreen` with node pricing; free `dataset-status`; standard Lucid routes.

**Deliverables:** source/lockfile, three collectors, hash verifier, entity matcher, GLEIF graph adapter, schemas, signed receipts, fixtures, tests, privacy/threat/model-risk docs, deployment and preview.

**Acceptance:** list hashes/times; explain matched and unmatched fields; name-only is never deterministic; source outage prevents no-match; relationship exceptions explicit; Base USDC/fail-closed payment; no double charge.

**Automated verification:** aliases/conflicts, list delta/hash failure, source outage, graph cycles/depth, privacy logs, payment/idempotency and standard-route smoke tests.

**Deployment/out of scope:** Cloudflare/Node + Postgres/signing key. No people/DOB in MVP, legal clearance, KYC docs, report filing or automatic blocking. **Suggested bounty:** 2,400 USDC, 28 days, bounty, public/reveal-on-submit, tags `lucid-agents,x402,sanctions,procurement,entity-resolution`.

## 10. Sources and assumptions

Verified:

- OFAC SLS: https://ofac.treasury.gov/sanctions-list-service
- OFAC file hashes: https://ofac.treasury.gov/specially-designated-nationals-list-sdn-list/hash-values-for-ofac-sanctions-list-files
- SAM Entity/Exclusions data services: https://sam.gov/entity-information
- ITA consolidated screening JSON API description: https://www.trade.gov/data
- GLEIF Level 2 ownership data: https://www.gleif.org/en/lei-data/access-and-use-lei-data/level-2-data-who-owns-whom

Estimates: prices, cost, volumes, latency, margins and break-even. Validate scoring on counsel-reviewed labelled examples and publish list-specific precision/escalation metrics. No result is a substitute for applicable law, ownership rules or qualified review.
