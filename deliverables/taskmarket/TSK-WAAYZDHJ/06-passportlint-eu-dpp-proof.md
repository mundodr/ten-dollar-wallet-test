# PassportLint: EU Digital Product Passport conformance proofs

## 1. Product thesis

**PassportLint** validates a candidate EU Digital Product Passport (DPP) against the applicable product-group rule set, access policy and machine-readability requirements, then produces a registry/import preflight evidence bundle. Buyers are product, marketplace, customs-preparation and supplier-onboarding agents that receive passports from many manufacturers and cannot operate a separate validator for every delegated act.

The recurring problem is versioned: requirements differ by product group and effective date, while identifiers, data carriers, access classes, completeness and source claims must agree. x402 is appropriate because validation happens per model/batch/item at a gate, often between companies with no standing API relationship.

## 2. Buyer workflow and usefulness

- **Trigger:** supplier uploads/updates a DPP; a marketplace lists a regulated product; an importer prepares release for free circulation.
- **Action:** accept, reject with exact paths, request fields, or create a signed preflight bundle for human/compliance review.
- **Frequency:** once per revision plus random rechecks; 100–1,000,000/month.
- **Value:** fewer rejected/passport-incomplete listings and lower manual schema review. KPIs: first-pass rate, false pass rate, and mean time to correct.

Evidence:

- Regulation (EU) 2024/1781 says covered products may be placed on the market only with a DPP under applicable delegated acts and requires accurate, complete, up-to-date data: https://eur-lex.europa.eu/eli/reg/2024/1781/oj
- Article 10 requires open, interoperable, machine-readable, structured, searchable and transferable data and a persistent unique product identifier.
- Article 13 requires the Commission registry and Article 14 a public search/comparison portal; the registry implementation is therefore a concrete integration target, not generic “ESG” demand.
- The same regulation distinguishes model, batch or item level and access rights, making a static universal checklist insufficient.

## 3. Endpoint product

One server-side Lucid runtime pins `@lucid-agents/core@5.0.0`, `@lucid-agents/http@4.0.0`, and `@lucid-agents/payments@5.0.0`.

### Paid entrypoint A — `lint-product-passport`

- **Path/purpose/buyer:** `POST /api/agent/entrypoints/lint-product-passport/invoke`; validate one JSON/JSON-LD DPP and its referenced data carrier against an exact ruleset; bought by supplier/marketplace agents.
- **Request:** `{productGroup,ruleSetDate,passport:{url?,document?,sha256?},level:"model"|"batch"|"item",intendedActors:string[],strictness:"registry-preflight"|"internal"}`
- **Example:** `{"productGroup":"battery","ruleSetDate":"2026-08-27","passport":{"url":"https://supplier.example/dpp/items/battery-123","sha256":"1111111111111111111111111111111111111111111111111111111111111111"},"level":"item","intendedActors":["consumer","customs"],"strictness":"registry-preflight"}`
- **Response:** `{verdict:"pass"|"fail"|"indeterminate", ruleSet:{id,version,sources}, checks:[{code,path,status,severity,message,evidence}], identifiers, accessMatrix, unresolved[], documentHash}`
- **Example:** `{"verdict":"fail","checks":[{"code":"DPP-ACCESS-004","path":"$.access.customs","status":"fail","severity":"error","message":"customs actor has no declared view"}],"unresolved":[],"documentHash":"sha256:1111111111111111111111111111111111111111111111111111111111111111"}`
- **Price:** `$0.02 + $0.00001 × inputKiB + $0.005 × referencedDocuments`, max $0.10.
- **SLO/data:** p95 <3 s for ≤1 MiB/3 refs; rule publication checked daily; 99.5% target.
- **Dependencies/errors:** versioned delegated-act/standard registry, JSON Schema/SHACL-style rules, safe URL retriever. `RULESET_NOT_FINAL`, `HASH_MISMATCH`, `REFERENCE_BLOCKED`; drafts yield indeterminate, never pass. Idempotency binds document and ruleset hashes.

### Paid entrypoint B — `build-registry-preflight-bundle`

- **Path/purpose:** `POST /api/agent/entrypoints/build-registry-preflight-bundle/invoke`; create a signed, portable submission/import evidence manifest from a passing passport, distinct from linting.
- **Request:** `{lintId, commodityCode?,operatorIdentifier,facilityIdentifiers?:string[], includeBackupAvailabilityProbe:boolean, bundleFormat:"json"|"jsonld"}`
- **Example:** `{"lintId":"pl_123","commodityCode":"85076000","operatorIdentifier":"urn:example:operator:example-industrial","includeBackupAvailabilityProbe":true,"bundleFormat":"jsonld"}`
- **Response:** `{bundleId,uniqueIdentifiers,commodityCode,ruleSetHash,passportHash,availabilityProbe,manifest,receiptJws,expiresAt,submissionReady:boolean,remainingHumanSteps[]}`
- **Price:** $0.07 base plus $0.01 per availability/backup probe, max $0.12.
- **SLO/data:** p95 <5 s; bundle reproducible by hashes. It does not submit to the Commission registry unless a future officially documented interface and buyer authorization exist.
- **Dependencies/errors:** lint artifact, identifier validators, availability probe, signer. A changed lint document invalidates bundle. Duplicate hash returns same receipt.

### Free and shared surfaces

`ruleset-status` returns supported product groups, legal/technical source status, effective dates, draft/final state and price quote. The runtime mounts `GET /api/agent/health`, `GET /api/agent/entrypoints`, `POST /api/agent/entrypoints/:key/invoke`, `POST /api/agent/entrypoints/:key/stream`, `/api/agent/.well-known/agent-card.json`, `/api/agent/.well-known/agent.json`, and `/api/agent/.well-known/oasf-record.json`. Paid endpoints show x402 offers and fail closed without payment config.

Entities: `RuleSet`, `Passport`, `Identifier`, `ActorAccess`, `Check`, `PreflightBundle`. URLs are allowlisted HTTP(S), size/content-type capped, fetched without cookies, and insulated from SSRF. Do not collect customer personal data; Article 10's personal-data constraint becomes a check. Non-goals: legal certification, issuing identifiers, hosting the authoritative DPP, market placement approval, customs filing, or inventing unpublished technical rules.

## 4. x402 payment design

Settle exact Base USDC. A free quote hashes ruleset version, document locator/hash, reference count and size bound. Payment is valid only for that immutable quote. Duplicate idempotency keys never re-charge. If a final ruleset is unavailable, the service refuses a registry-preflight offer before payment; internal draft linting can be explicitly purchased and labelled. If paid external references are unreachable before analysis, refund/credit; if optional probes fail, return partial probe status. Proof bundles are content-addressed and freely retrievable; raw documents follow configurable retention.

## 5. Market analysis

Beachhead: independent DPP service providers and marketplaces needing a second validator for early covered groups. Timing is tied to the EU regulation, registry and product-specific delegated acts.

Competitors/substitutes:

1. **Circularise** — DPP and supply-chain traceability platform: https://www.circularise.com/digital-product-passport
2. **Siemens Battery Passport** — industrial battery passport offering: https://www.siemens.com/global/en/products/automation/topic-areas/digital-enterprise/digital-product-passport.html
3. **SAP Responsible Design and Production** — product compliance/circular-economy workflow: https://www.sap.com/products/scm/responsible-design-and-production.html
4. In-house schema validators and consultant review — tailored but costly to keep versioned.

PassportLint does not compete as another passport host. Its wedge is independent, content-addressed validation bought per artifact. A moat forms from audited rule translations, cross-provider failure fixtures and regulator/standard change tracking. Hosts may add native linting; independent preflight and portability remain valuable.

## 6. Unit economics and profitability

Estimated representative economics:

| call | revenue | rules/data/compute | storage/signing | gross profit | margin |
| --- | ---: | ---: | ---: | ---: | ---: |
| 300 KiB lint + 2 refs | $0.033 | $0.004 | $0.001 | $0.028 | 85% |
| bundle + probe | $0.080 | $0.009 | $0.002 | $0.069 | 86% |

At 85/15 mix:

| calls/month | revenue | variable cost | gross profit |
| ---: | ---: | ---: | ---: |
| 10,000 | $400.50 | $57.50 | $343 |
| 100,000 | $4,005 | $575 | $3,430 |
| 1,000,000 | $40,050 | $5,750 | $34,300 |

Assumed fixed legal/standards review and hosting: $4,000/month; break-even ~116,700 mixed calls. Rule-maintenance cost is the sensitive variable. Distribution: DPP provider plugins, marketplace import hooks, x402 directories, and free ruleset-change feed.

## 7. Competitive strength

Material differentiation is validator independence, exact legal/technical source version, fail-closed draft handling and portable proof. Initial positioning: “lint once before every registry or marketplace gate.” The defensible asset is human-reviewed rule encoding and a conformance corpus across providers, not a proprietary identifier. If major platforms standardize, PassportLint can become the neutral CI/conformance test used across them.

## 8. Feasibility and MVP plan

Architecture: Lucid runtime; versioned rules repository; JSON Schema plus semantic checks; isolated reference fetcher; object store; signer; admin review workflow requiring two-person approval for rule changes. Begin with a synthetic, clearly labelled ESPR core profile until one product-group final technical ruleset is published; never market drafts as legal conformance.

Sequence: core requirements → ruleset provenance → lint endpoint → reference/access checks → signed bundle → one final product-group adapter. Tests: model/batch/item mismatch, identifiers, access matrix, missing/extra fields, personal data flags, malicious JSON-LD/URLs, stale refs, draft rules, hash changes, signatures, idempotency, payments and standard routes. Licensing of standards may constrain redistribution; store citations and executable rules only as permitted. The smallest honest MVP is a core-requirement structural preflight labelled non-certifying.

## 9. Copy-paste-ready Taskmarket build brief

**Task title:** Build PassportLint Lucid x402 DPP conformance preflight

**Description:** Implement a TypeScript service that validates a JSON/JSON-LD product passport against a versioned, cited ESPR core profile, reports every rule path, and creates a signed content-addressed preflight bundle. Draft rules must never yield a final pass.

**Stack:** exact Lucid `core@5.0.0`, `http@4.0.0`, `payments@5.0.0`; TypeScript, Zod/JSON Schema, SQL, object storage, JWS signer, isolated fetcher.

**Entrypoints:** paid `lint-product-passport` using size/reference pricing; paid `build-registry-preflight-bundle`; free `ruleset-status`; all standard Lucid routes.

**Deliverables:** source, lockfile, rule provenance format, core ruleset, schemas, safe fetcher, lint engine, signed bundle/verifier, 60 fixtures, tests, legal/non-certification boundary, deployment and preview.

**Acceptance:** exact rule version/source; deterministic document hash; draft/unresolved rule is indeterminate; SSRF-safe; personal-data check; explicit Base USDC; fail closed; duplicate payment/idempotency safe; receipt independently verifies.

**Automated verification:** pass/fail/indeterminate fixtures, access/identifier levels, malicious JSON-LD, unreachable refs, rule update invalidation, signature tamper, payment states and standard route smoke tests.

**Deployment/out of scope:** Cloudflare/Node plus SQL/storage/signing key. No certification, identifier issuance, registry submission, customs filing or passport hosting. **Suggested bounty:** 2,200 USDC, 28 days, bounty, public/reveal-on-submit, tags `lucid-agents,x402,dpp,eu-compliance,provenance`.

## 10. Sources and assumptions

Verified:

- Regulation (EU) 2024/1781, especially Articles 9–15: https://eur-lex.europa.eu/eli/reg/2024/1781/oj
- Official PDF text: https://eur-lex.europa.eu/eli/reg/2024/1781/oj/eng/pdf
- Commission implementation context for the DPP registry: https://commission.europa.eu/document/download/ed809250-bcc6-4afc-948f-795f2451e5c2_en

Estimates: pricing, input sizes, demand, costs, margins, latency, timeline and competitor fit. Product-group rules and standards must be re-verified at build time; no unpublished requirement is assumed. Legal conformance requires qualified review beyond this technical preflight.
