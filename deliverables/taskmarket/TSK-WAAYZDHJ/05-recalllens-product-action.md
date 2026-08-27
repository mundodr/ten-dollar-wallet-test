# RecallLens: cross-regulator product recall action packets

## 1. Product thesis

**RecallLens** tells a commerce, procurement, repair, rental, or warehouse agent whether an exact product/lot is implicated by a current U.S. recall and what operational action the authoritative notice supports. It resolves messy identifiers across CPSC, FDA, NHTSA and buyer product data, cites the match, and never turns similarity into certainty.

The recurring problem is not obtaining one regulator's feed; it is deciding whether “this item in this order” matches a recall despite variant names, lot/date ranges, UPCs, NDCs, VINs and incomplete catalog metadata. x402 fits the per-item decision and post-notice delta check, letting a low-volume agent buy evidence without maintaining four pipelines.

## 2. Buyer workflow and usefulness

- **Trigger:** before purchase/fulfillment/resale, at inventory scan, or when a new recall appears.
- **Action:** pass, quarantine, stop-sale, inspect a lot, notify a human, or follow the cited remedy.
- **Frequency:** one screen per high-risk SKU/asset and delta scans after feed updates.
- **Value:** fewer false quarantines and fewer recalled products shipped; KPIs are confirmed-match precision, unresolved rate, and time from regulator publication to buyer action.

Evidence:

- CPSC's Recall API provides public recall information in JSON or XML: https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information
- openFDA food enforcement reports come from the FDA Recall Enterprise System and are updated weekly: https://open.fda.gov/apis/food/enforcement/
- openFDA device enforcement data covers publicly releasable records from 2004 and can change when source records are corrected: https://open.fda.gov/apis/device/enforcement/
- NHTSA offers recall APIs by make/model/year and VIN: https://api.nhtsa.gov/

## 3. Endpoint product

One runtime uses `@lucid-agents/core@5.0.0`, `@lucid-agents/http@4.0.0`, and `@lucid-agents/payments@5.0.0` server-side.

### Paid entrypoint A — `screen-product-instance`

- **Path/purpose:** `POST /api/agent/entrypoints/screen-product-instance/invoke`; match one product/lot/vehicle/device to current authoritative records.
- **Buyer:** checkout, warehouse, procurement or resale agent.
- **Request:** `{jurisdiction:"US", product:{name,brand?,model?,upc?,gtin?,lot?,serial?,manufacturedAt?,vin?,ndc?}, categories?:string[], strictness:"high-precision"|"balanced", asOf?}`
- **Example:** `{"jurisdiction":"US","product":{"name":"portable power bank","brand":"Acme","model":"P10","upc":"012345678905","lot":"24Q3"},"strictness":"high-precision"}`
- **Response:** `{verdict:"confirmed"|"possible"|"clear"|"unknown", checkedAt, matchedNotices:[{regulator,noticeId,title,publishedAt,status,match:{fields,score,explanation},affectedRange,remedy,sourceUrl,sourceHash}],missingIdentifiers[],nextCheckAt}`
- **Example:** `{"verdict":"possible","matchedNotices":[{"regulator":"CPSC","noticeId":"26-123","match":{"fields":["brand","model"],"score":0.82,"explanation":"lot range unavailable"},"remedy":"stop use and follow notice","sourceUrl":"https://www.cpsc.gov/Recalls"}],"missingIdentifiers":["serial"],"nextCheckAt":"2026-08-28T00:00:00Z"}`
- **Price:** $0.004 for one regulator family; $0.0015 each additional, max $0.01.
- **SLO/data:** p95 <1.5 s from feeds no older than their published update cadence; source `lastModified` reported; 99.9% target.
- **Dependencies/errors:** regulator feeds, identifier normalization and deterministic range matcher. `UNSUPPORTED_IDENTIFIER`, `SOURCE_STALE`, `AMBIGUOUS_MATCH`; `clear` requires all selected sources healthy. Idempotency binds source snapshot.

### Paid entrypoint B — `build-quarantine-action-pack`

- **Path/purpose:** `POST /api/agent/entrypoints/build-quarantine-action-pack/invoke`; turn a confirmed/possible match and an inventory list into an operational, non-legal action file—different from one-item screening.
- **Request:** `{screeningId, inventory:[{itemId,location,identifiers,quantity}], policy:{possibleMatchAction:"hold"|"human-review", includeCustomerNoticeDraft:boolean}}`
- **Example:** `{"screeningId":"rl_123","inventory":[{"itemId":"sku-9","location":"WH-A","identifiers":{"lot":"24Q3"},"quantity":37}],"policy":{"possibleMatchAction":"hold","includeCustomerNoticeDraft":false}}`
- **Response:** `{actionId, items:[{itemId,action,reason,noticeRef}], totals, checklist, regulatorContacts, remedyLinks, csvArtifactUrl, evidenceManifest}`
- **Price:** `$0.012 + $0.00002 × itemCount`, capped at $0.10/5,000 items.
- **SLO/data:** p95 <5 s/1,000 items; output source snapshot matches screening. No customer message is sent.
- **Dependencies/errors:** stored screening, bounded batch matcher, CSV generator. Input over cap is 413; changed inventory with reused key is 409; same hash retrieves same pack.

### Free and shared surfaces

`source-status` publishes regulators, feed ages, identifiers and exact prices. The runtime mounts `GET /api/agent/health`, `GET /api/agent/entrypoints`, `POST /api/agent/entrypoints/:key/invoke`, `POST /api/agent/entrypoints/:key/stream`, `/api/agent/.well-known/agent-card.json`, `/api/agent/.well-known/agent.json`, and `/api/agent/.well-known/oasf-record.json`. Paid x402 offers are explicit; no payment configuration means typed failure, never free service.

Entities: `ProductIdentity`, `RecallNotice`, `AffectedRange`, `Match`, `InventoryItem`, `ActionPack`. Inventory is minimized, encrypted and deleted after 24 hours; no customer identity needed. UPC/VIN/lot formats are validated. Non-goals: medical advice, risk scoring beyond the notice, contacting customers, replacing regulator instructions, or declaring a product legally safe.

## 4. x402 payment design

Exact Base USDC. The payment amount is deterministic from source families or batch size and advertised before the item data is processed. `Idempotency-Key` + request hash + source snapshot prevents double charges. If a selected source is stale/unavailable, a high-precision `clear` cannot be returned; the buyer gets `unknown` and an automatic credit/refund when no useful selected-source result exists. Results can be retrieved free by ID for 30 days, while raw inventory expires sooner. A delta bundle can discount repeated screens of the same catalog, but per-item buying remains available.

## 5. Market analysis

Beachhead: recommerce, rental and small marketplace agents screening electronics and consumer products before listing/fulfillment. These operators often lack a master-data team yet make item-level automated decisions.

Alternatives:

1. **CPSC Recall API** — authoritative consumer-product feed, but only CPSC and not item-resolution workflow.
2. **openFDA enforcement APIs** — authoritative FDA-family records, but buyers join categories and identifiers themselves.
3. **NHTSA Recall API** — strong VIN/vehicle coverage, separate from other product feeds.
4. **Recalls.gov/manual search** — human portal across agencies, not an idempotent agent response: https://www.recalls.gov/

RecallLens's wedge is conservative cross-source identity resolution with evidence at the item/lot level. Moat: verified alias/range parsers, correction history, false-match feedback and source-specific fixtures. Regulators could unify feeds; the operational action pack and buyer catalog normalization remain valuable.

## 6. Unit economics and profitability

Estimated economics:

| call | revenue | source/compute | storage | gross profit | margin |
| --- | ---: | ---: | ---: | ---: | ---: |
| four-family screen | $0.0085 | $0.0005 | $0.0002 | $0.0078 | 92% |
| 1,000-item pack | $0.0320 | $0.0030 | $0.0010 | $0.0280 | 88% |

At 95/5 screen/action mix:

| calls/month | revenue | variable cost | gross profit |
| ---: | ---: | ---: | ---: |
| 50,000 | $482.50 | $47.75 | $434.75 |
| 500,000 | $4,825 | $477.50 | $4,347.50 |
| 5,000,000 | $48,250 | $4,775 | $43,475 |

Assumed fixed operations/review $1,500/month; break-even ~172,500 mixed calls. Human alias review and liability controls are the sensitive costs. Distribution: commerce/recommerce SDK examples, x402 directories, free source freshness, and integrations with inventory agents.

## 7. Competitive strength

The service is better than a raw search because it distinguishes confirmed/possible/unknown, explains the identifier evidence, and produces a repeatable hold list. Positioning is “never confuse no match with no data.” The defensible asset is the mapping/range correction corpus and precision measurements. Incumbents may add cross-feed search; RecallLens remains agent-native, transaction-priced and transparent about source state.

## 8. Feasibility and MVP plan

MVP ingests CPSC and one openFDA category, preserves raw/source hashes, normalizes notices, and supports UPC/brand/model/lot. Architecture: Lucid runtime, scheduled collectors, Postgres search indexes, deterministic match engine, encrypted ephemeral batch store, artifact storage. Add NHTSA VIN only after separate fixtures.

Tests: notice corrections/withdrawals, Unicode/alias normalization, lot/date ranges, UPC check digits, false-positive names, one source down, stale feed, batch consistency, output escaping, retention deletion, idempotency, payment missing/duplicate and every standard route. Data is public but terms/rate limits and notice attribution must be followed. MVP never gives clinical advice or infer severity beyond source classification.

## 9. Copy-paste-ready Taskmarket build brief

**Task title:** Build RecallLens cross-regulator recall matching API with Lucid x402

**Description:** Build a TypeScript service that ingests CPSC and openFDA enforcement feeds, conservatively screens an exact product/lot, and creates a source-linked inventory quarantine file without sending messages.

**Stack:** Lucid `core@5.0.0`, `http@4.0.0`, `payments@5.0.0`; TypeScript, Zod, Postgres, object storage, scheduled collectors.

**Entrypoints:** paid `screen-product-instance` using source-family pricing, paid `build-quarantine-action-pack` using item-count pricing, free `source-status`, and all standard Lucid surfaces.

**Deliverables:** source/lockfile, raw and normalized schemas, two collectors, matcher, correction handling, CSV/action artifacts, retention job, 100 recall fixtures, tests, threat/accuracy report, deployment and preview.

**Acceptance:** confirmed requires decisive identifier evidence; source outage prevents `clear`; exact source URL/hash/timestamp; batch actions trace to matches; no customer PII; explicit Base USDC; fail closed; duplicate key no double charge.

**Automated verification:** alias/lot/date/check-digit fixtures, feed correction, source outage, malicious text, retention, 5,000-item cap, payment/idempotency, standard routes, typecheck/lint/tests.

**Deployment/out of scope:** Cloudflare/Node with Postgres/object storage. No medical/legal advice, customer contact, risk invention, or regulator replacement. **Suggested bounty:** 1,600 USDC, 21 days, bounty, public/reveal-on-submit, tags `lucid-agents,x402,recalls,commerce,product-safety`.

## 10. Sources and assumptions

Verified:

- CPSC Recall API: https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information
- openFDA food enforcement scope/update: https://open.fda.gov/apis/food/enforcement/
- openFDA device enforcement and correction behavior: https://open.fda.gov/apis/device/enforcement/
- NHTSA APIs: https://api.nhtsa.gov/

Estimates: prices, call volume, costs, margins, latency and break-even. Validate precision/recall on a labelled historical set and publish source-specific false-positive/unknown rates. An absent match is not a safety guarantee.
