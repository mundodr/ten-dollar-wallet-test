# RightsRoute: machine-readable dataset-use and attribution evidence

## 1. Product thesis

**RightsRoute** helps a model-training, evaluation, retrieval or data-purchasing agent decide whether a named dataset revision has enough machine-readable rights/provenance evidence for a declared use. It produces an evidence matrix and, when possible, a reproducible attribution/provenance manifest. It never interprets silence as permission or replaces legal review.

The buyer is an autonomous ML/data pipeline that encounters thousands of dataset cards, repository files and custom terms. The recurring problem is revision-specific: metadata may name a licence while files, sources, subsets or custom terms conflict or remain undocumented. x402 fits because the agent needs a small answer for a particular dataset+revision+use, often before downloading expensive data and without a standing compliance SaaS contract.

## 2. Buyer workflow and usefulness

- **Trigger:** before a dataset is downloaded, combined, fine-tuned on, redistributed, benchmarked, or included in RAG.
- **Action:** allow under internal policy, collect attribution, reject, request clarification, or escalate an ambiguity.
- **Frequency:** one screen per dataset revision/use and one manifest per approved training/evaluation build.
- **Value:** fewer unusable downloads and reproducible provenance. KPIs: percent with decisive evidence, false-clear rate, and time to assemble notices/attribution.

Evidence:

- Hugging Face dataset cards expose YAML metadata including licence, language and size, but responsible-use context lives in free-form cards: https://huggingface.co/docs/hub/datasets-cards
- Hugging Face supports custom licences via name/link metadata, creating non-uniform terms that require retrieval: https://huggingface.co/docs/hub/model-cards#specifying-a-license
- SPDX provides stable identifiers, texts, canonical URLs and expression syntax for software/data/documentation licences: https://spdx.dev/learn/handling-license-info/
- Creative Commons describes lawyer-readable, human-readable and machine-readable licence layers; ccREL is its rights-expression language: https://creativecommons.org/legal-code-defined/ and https://opensource.creativecommons.org/ccrel/

## 3. Endpoint product

One server-side Lucid runtime pins `@lucid-agents/core@5.0.0`, `@lucid-agents/http@4.0.0`, and `@lucid-agents/payments@5.0.0`.

### Paid entrypoint A — `evaluate-dataset-use`

- **Path/purpose:** `POST /api/agent/entrypoints/evaluate-dataset-use/invoke`; evaluate evidence sufficiency for one declared use, not give a universal legal label.
- **Buyer:** training/evaluation/RAG/data-purchase agent.
- **Request:** `{dataset:{hub:"huggingface"|"github"|"url",id?,url?,revision,expectedSha256?}, intendedUse:{purpose:"training"|"evaluation"|"rag"|"redistribution",commercial:boolean,willPublishWeights:boolean,willRedistributeRows:boolean,jurisdictions?:string[]}, policy:{allowedSpdx?:string[],denyNonCommercial?:boolean,requireSourceProvenance:boolean,unknownIsDeny:boolean}}`
- **Example:** `{"dataset":{"hub":"huggingface","id":"org/data","revision":"abc123"},"intendedUse":{"purpose":"training","commercial":true,"willPublishWeights":true,"willRedistributeRows":false},"policy":{"allowedSpdx":["Apache-2.0","CC-BY-4.0"],"denyNonCommercial":true,"requireSourceProvenance":true,"unknownIsDeny":true}}`
- **Response:** `{verdict:"policy_allow"|"policy_deny"|"human_review",revisionHash,evidence:[{source,path,claim,value,confidence,hash}],licenceExpression?,obligations[],conflicts[],missing[],policyTrace[],notLegalAdvice:true}`
- **Example:** `{"verdict":"human_review","licenceExpression":"CC-BY-4.0","obligations":["attribution"],"conflicts":[{"source":"README","claim":"research only","sourcePath":"README.md#terms"}],"missing":["row-level source provenance"]}`
- **Price:** `$0.015 + $0.003 × fetchedEvidenceDocument`, max $0.06/15 documents.
- **SLO/data:** p95 <4 s; exact revision/hash required; 99.5% target.
- **Dependencies/errors:** Hub/Git fetchers, SPDX/CC metadata, deterministic policy engine, bounded term extractor. `REVISION_MOVED`, `CUSTOM_TERMS`, `SOURCE_MISSING`; custom terms default human review. Same revision/use/policy hash is idempotent.

### Paid entrypoint B — `build-attribution-provenance-manifest`

- **Path/purpose:** `POST /api/agent/entrypoints/build-attribution-provenance-manifest/invoke`; generate a portable, machine-verifiable manifest for an allowed/reviewed dataset set, distinct from permission screening.
- **Request:** `{evaluationIds:string[], project:{name,version,artifactSha256?}, includeNotices:boolean, format:"spdx-json"|"cyclonedx"|"jsonld", acknowledgedHumanReviews?:[{evaluationId,decisionRef}]}`
- **Example:** `{"evaluationIds":["rr_1","rr_2"],"project":{"name":"eval-corpus","version":"2026.08","artifactSha256":"1111111111111111111111111111111111111111111111111111111111111111"},"includeNotices":true,"format":"spdx-json"}`
- **Response:** `{manifestId,format,components:[{dataset,revision,hash,licence,sourceRefs,attribution}],noticesArtifactUrl,unresolved[],manifestSha256,receiptJws,reproducible:boolean}`
- **Price:** `$0.035 + $0.005 × datasetCount`, max $0.25/43 datasets.
- **SLO/data:** p95 <10 s/25 datasets; each component pinned; custom licence text included only where redistribution permits.
- **Dependencies/errors:** stored evaluations, SPDX tooling, notice generator, signer. Unacknowledged human-review items stay unresolved and make `reproducible:false`. Same set/project hash returns same receipt.

### Free and shared surfaces

`metadata-preview` returns revision existence, detected metadata locations, document count, supported formats and exact quote—no use verdict. The runtime mounts `GET /api/agent/health`, `GET /api/agent/entrypoints`, `POST /api/agent/entrypoints/:key/invoke`, `POST /api/agent/entrypoints/:key/stream`, `/api/agent/.well-known/agent-card.json`, `/api/agent/.well-known/agent.json`, and `/api/agent/.well-known/oasf-record.json`. Paid handlers advertise x402 and fail closed without payment configuration.

Entities: `DatasetRevision`, `RightsEvidence`, `LicenceExpression`, `IntendedUse`, `Policy`, `Evaluation`, `ProvenanceManifest`. Only public or buyer-authorized URLs; no gated dataset credentials in MVP. Safe fetcher blocks SSRF, archives, huge files and executable content. Terms text is untrusted data. Non-goals: copyright/legal opinions, downloading dataset rows, detecting personal data in all records, clearing privacy/publicity rights, or claiming weight-training law is settled.

## 4. x402 payment design

Exact Base USDC. Free preview generates a quote tied to dataset revision, evidence-document inventory, intended-use and policy hashes. Payment buys that immutable analysis. If a mutable branch moves before fetch completes, return `REVISION_MOVED` and refund/new quote. Duplicate idempotency keys do not charge again. Optional missing documents can produce human review; a total fetch failure refunds. Manifests/results remain free to retrieve by content hash; source terms are stored only as licences allow. Batches discount repeated metadata retrieval, not verdict outcome.

## 5. Market analysis

Beachhead: evaluation/training agents choosing public Hugging Face and GitHub datasets under strict internal allowlists. The product does not need to solve global copyright to be useful: it can prove what metadata exists, identify conflicts and fail closed.

Alternatives:

1. **Hugging Face dataset cards/filters** — useful licence metadata and context, but no revision-specific declared-use policy trace.
2. **SPDX tooling** — standardized licences/SBOM facts, but not an end-to-end dataset-card/source conflict evaluator.
3. **FOSSology** — open-source licence scanning/compliance workflows: https://www.fossology.org/
4. Manual legal/data-governance review — authoritative judgment but expensive for initial triage.

RightsRoute's wedge is evidence sufficiency, not automated legal certainty. It makes custom/conflicting/missing terms visible before data movement and emits a portable manifest. Moat: revision-pinned metadata adapters, conflict fixtures, policy traces and reviewer correction feedback. Hubs may add richer metadata; cross-hub, project-level manifests remain valuable.

## 6. Unit economics and profitability

Estimated:

| call | revenue | fetch/extraction | storage/signing | gross profit | margin |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5-document evaluation | $0.030 | $0.004 | $0.001 | $0.025 | 83% |
| 10-dataset manifest | $0.085 | $0.012 | $0.003 | $0.070 | 82% |

At 80/20 mix:

| calls/month | revenue | variable cost | gross profit |
| ---: | ---: | ---: | ---: |
| 10,000 | $410 | $70 | $340 |
| 100,000 | $4,100 | $700 | $3,400 |
| 1,000,000 | $41,000 | $7,000 | $34,000 |

Assumed fixed legal-policy QA and operations $3,500/month; break-even ~103,000 calls. Human review rate and custom-terms extraction are sensitive. Distribution: Hugging Face/GitHub CI examples, x402 directories, free metadata-lint badges and ML pipeline plugins.

## 7. Competitive strength

Unlike a licence filter, RightsRoute reports the exact revision, every evidence source, contradictions, missing provenance and the internal policy trace. Positioning: “prove what the dataset says before you move it.” The defensible asset is a conformance/conflict corpus and reviewer feedback, not secret legal rules. Hubs could add policy evaluation; cross-hub evidence, manifest portability and accountless low-volume access remain defensible.

## 8. Feasibility and MVP plan

Architecture: Lucid runtime; content-addressed Hugging Face/GitHub fetchers; YAML/front-matter parser; SPDX expression parser; CC REL reader; bounded custom-terms extractor; deterministic policy engine; manifest generator/signer; SQL/object storage. Begin with public pinned revisions and metadata/README/LICENCE files only.

Tests: moving branches, missing/invalid SPDX, dual licences, custom terms, README/licence conflicts, non-commercial policy, absent provenance, malicious YAML/Markdown/URLs, oversized files, notice generation, manifest determinism, signature tamper, idempotency, payment duplicate and standard routes. Preserve licences/attribution and do not store full custom texts without permission. The smallest MVP returns human review whenever evidence is not a recognized SPDX/CC expression with no conflicts.

## 9. Copy-paste-ready Taskmarket build brief

**Task title:** Build RightsRoute Lucid x402 dataset-rights evidence API

**Description:** Build a TypeScript service that inspects a pinned public Hugging Face or GitHub dataset revision, extracts licence/provenance evidence, applies a buyer-declared policy conservatively, and emits a signed SPDX-JSON attribution/provenance manifest.

**Stack:** Lucid `core@5.0.0`, `http@4.0.0`, `payments@5.0.0`; TypeScript/Zod, SPDX parser, safe fetcher, SQL/object storage, JWS signer.

**Entrypoints:** paid `evaluate-dataset-use` with document-count pricing; paid `build-attribution-provenance-manifest` with dataset-count pricing; free `metadata-preview`; all standard Lucid routes.

**Deliverables:** source/lockfile, two hub adapters, safe fetcher, evidence/policy schemas, SPDX/CC parsers, conflict detector, manifest/verifier, 50 fixtures, tests, legal-boundary/threat docs, cost benchmark, deployment and preview.

**Acceptance:** exact immutable revision/hash; recognized/custom/missing separated; conflict or unknown never auto-allows under fail-closed policy; reproducible manifest; Base USDC explicit/fail closed; duplicate safe; no dataset row download.

**Automated verification:** licence combinations/conflicts, moving refs, malicious metadata, oversized fetch, policy traces, manifest hash/signature, payment/idempotency and standard routes.

**Deployment/out of scope:** Cloudflare/Node + SQL/storage/signing key. No gated credentials, row-content scan, legal advice, privacy/publicity clearance or universal training-rights conclusion. **Suggested bounty:** 1,900 USDC, 24 days, bounty, public/reveal-on-submit, tags `lucid-agents,x402,datasets,licensing,provenance`.

## 10. Sources and assumptions

Verified:

- Hugging Face dataset-card metadata: https://huggingface.co/docs/hub/datasets-cards
- Hugging Face custom licence metadata: https://huggingface.co/docs/hub/model-cards#specifying-a-license
- SPDX identifiers/texts/URLs: https://spdx.dev/learn/handling-license-info/
- Creative Commons machine-readable layers/ccREL: https://creativecommons.org/legal-code-defined/ and https://opensource.creativecommons.org/ccrel/
- Data.gov also surfaces licence/access metadata when provided, illustrating broader catalog applicability: https://data.gov/user-guide/

Estimates: prices, volumes, costs, margins, latency and break-even. Validate parser precision and reviewer agreement on a stratified public-dataset sample. A policy verdict reports configured evidence handling; it is not a legal determination and cannot clear undocumented underlying rights.
