# BorderBill: shipment-specific landed-cost and customs evidence

## 1. Product thesis

**BorderBill** gives commerce and procurement agents a bounded, cited estimate before they commit to a cross-border purchase. It converts an origin, destination, candidate HS code, value, freight, insurance, and product facts into (a) the applicable duty/tax calculation and (b) a document/admissibility checklist with explicit uncertainty.

The buyer is an autonomous purchasing, quoting, or fulfillment agent. The recurring expensive problem is that an attractive unit price is not the landed price; duties, taxes, other fees, product requirements, and rules of origin can change the decision. Per-shipment x402 is better than a seat licence for agents that quote across many principals or markets and need one auditable answer at checkout.

## 2. Buyer workflow and usefulness

- **Trigger:** a cart, supplier quote, or routing option crosses a customs border.
- **Action:** choose supplier/Incoterm/route, ask for missing origin evidence, or escalate to a broker.
- **Frequency:** one classification screen and one landed-cost packet per candidate shipment; 20–10,000/month per buyer.
- **Value:** avoided margin error, fewer held shipments, and consistent evidence attached to the purchase record. A measurable KPI is estimate-to-broker variance by duty component.

Evidence:

- The U.S. International Trade Administration explains that duties, taxes and fees affect final cost and that only customs authorities make final determinations: https://www.trade.gov/import-tariffs-fees-overview
- USITC publishes current and archived Harmonized Tariff Schedule releases, with frequent 2026 revisions: https://hts.usitc.gov/download/archive
- CBP's ACE is the U.S. single-window platform for manifest, cargo release, entry and partner-government-agency data: https://www.cbp.gov/trade/automated/how-to-use-ace
- ITA publishes JSON APIs including FTA tariff rates and consolidated screening data: https://www.trade.gov/data

## 3. Endpoint product

One server-side Lucid runtime pins `@lucid-agents/core@5.0.0`, `@lucid-agents/http@4.0.0`, and `@lucid-agents/payments@5.0.0`.

### Paid entrypoint A — `evaluate-tariff-candidates`

- **Path/purpose:** `POST /api/agent/entrypoints/evaluate-tariff-candidates/invoke`; rank supplied or retrieved HS/HTS candidates and show what product facts distinguish them. It does not make a binding classification.
- **Buyer:** purchasing or customs-preparation agent before pricing.
- **Request:** `{importCountry,exportCountry,asOfDate,description,composition?,function?,candidateCodes?:string[],evidenceUrls?:string[]}`
- **Example:** `{"importCountry":"US","exportCountry":"VN","asOfDate":"2026-08-27","description":"rechargeable LED desk lamp, aluminum housing","composition":{"aluminum":0.62,"electronics":0.38},"candidateCodes":["9405.21","8513.10"]}`
- **Response:** `{datasetVersion,candidates:[{code,description,baseRate,additionalMeasures,fitScore,decisiveFacts,sourceRefs}],missingFacts[],bindingRulingRecommended}`. Example: `{"datasetVersion":"USITC-2026-r11","candidates":[{"code":"9405.21.80","fitScore":0.76,"decisiveFacts":["designed for table placement"],"sourceRefs":["https://hts.usitc.gov/"]}],"missingFacts":["battery removable?"],"bindingRulingRecommended":true}`.
- **Price:** $0.04 for ≤5 candidates; $0.006 each additional, max 15.
- **SLO/data:** p95 3 s; schedules pinned to published revision and effective date; 99.5% control-plane target.
- **Dependencies/errors:** official tariff schedules, rulings corpus where licensed, rules engine and bounded retrieval. `DATE_NOT_COVERED`, `INSUFFICIENT_FACTS`, or `MEASURE_UNRESOLVED`; ambiguous stays ambiguous. Idempotent by request+dataset hash.

### Paid entrypoint B — `quote-landed-cost-pack`

- **Path/purpose:** `POST /api/agent/entrypoints/quote-landed-cost-pack/invoke`; compute a shipment-level cost range and checklist, distinct from classification analysis.
- **Request:** `{origin,destination,code,customsValue:{amount,currency},freight,insurance,quantity,incoterm,originEvidence?,productAttributes,scenario?:{ftaClaim:boolean}}`
- **Example:** `{"origin":"VN","destination":"US","code":"9405.21.60","customsValue":{"amount":1200,"currency":"USD"},"freight":180,"insurance":12,"quantity":40,"incoterm":"DAP","scenario":{"ftaClaim":false},"productAttributes":{"battery":"lithium-ion"}}`
- **Response:** `{currency,calculation:{customsValue,duty,additionalDuty,tax,fees,brokerExcluded,totalLow,totalHigh},formulae[],documents[],admissibilityChecks[],assumptions[],sources[],validUntil}`
- **Example:** `{"currency":"USD","calculation":{"customsValue":1200,"duty":72,"additionalDuty":0,"tax":0,"fees":14.64,"brokerExcluded":true,"totalLow":1286.64,"totalHigh":1310},"documents":[{"name":"commercial invoice","status":"required"}],"assumptions":["candidate code supplied by buyer"],"validUntil":"2026-08-28T00:00:00Z"}`
- **Price:** $0.075 base plus $0.01 per extra regulatory dataset, hard cap $0.125.
- **SLO/data:** p95 4 s; FX ≤1 hour; official rules as-of request date. External outage returns component-level `unknown`, never zero.
- **Dependencies:** tariff/FTA/fee tables, FX, restricted-party and product-agency rule sources; no filing. Retries only read failures. Idempotency locks calculation inputs and dataset versions.

### Free and shared surfaces

`coverage-and-quote` reports countries, dates, datasets and exact price. The runtime mounts `GET /api/agent/health`, `GET /api/agent/entrypoints`, `POST /api/agent/entrypoints/:key/invoke`, `POST /api/agent/entrypoints/:key/stream`, `/api/agent/.well-known/agent-card.json`, `/api/agent/.well-known/agent.json`, and `/api/agent/.well-known/oasf-record.json`. Paid entries advertise x402 and fail closed without payment configuration.

Entities: `TariffRevision`, `ClassificationCandidate`, `Measure`, `ShipmentScenario`, `CostComponent`, `DocumentRequirement`, `EvidenceRef`. Authentication is unnecessary for public facts; signed buyer uploads are short-lived and deleted. Protect against prompt injection in product pages, SSRF, unsupported currencies, unit ambiguity and sanctions-list false positives. Non-goals: customs filing, broker representation, binding classification, tax/legal advice, evasion, or restricted-goods optimization.

## 4. x402 payment design

Settlement is Base mainnet USDC. The free quote returns an immutable `quoteId` containing jurisdictions, requested datasets, tariff revision, FX source, price and 15-minute expiry. After exact payment, the same request produces the result. Duplicate `Idempotency-Key` returns the prior packet without another charge; input changes require a new quote. If no authoritative schedule covers the date before work starts, refund. If one optional dataset fails, return partial results and a proportional credit only when the buyer allowed partials. Calculation artifacts remain retrievable free for 30 days. Volume bundles may reduce price up to 25%, while every response records the same evidence standard.

## 5. Market analysis

Beachhead: small cross-border sellers and autonomous sourcing agents making U.S.-bound quotes with known product codes. The official guidance explicitly treats tariff/tax estimation as part of pricing, while HTS revisions show why stale spreadsheets are risky.

Competitors/substitutes:

1. **Descartes CustomsInfo** — a global tariff/tax lookup referenced by ITA, but registration/product contracts are oriented to ongoing users.
2. **Avalara AvaTax Cross-Border** — landed-cost/compliance platform for merchants: https://www.avalara.com/us/en/products/cross-border.html
3. **DHL MyGTS** — trade-lane and landed-cost tools tied to DHL workflows: https://mygts.dhl.com/
4. Freight forwarder/customs broker email — authoritative human support but slow and not an instant agent contract.

BorderBill's wedge is a small, portable, evidence-hashed packet that exposes uncertainty and is bought per decision. A moat can form from normalized tariff revisions, resolved ambiguity feedback, and estimate-to-final-entry calibration. It remains a preparation layer, not a broker substitute.

## 6. Unit economics and profitability

Estimated costs:

| Call | revenue | data/FX | compute/storage | gross profit | margin |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5-code evaluation | $0.040 | $0.006 | $0.003 | $0.031 | 78% |
| landed-cost base | $0.075 | $0.018 | $0.004 | $0.053 | 71% |

At a 40/60 mix:

| calls/month | revenue | variable cost | gross profit |
| ---: | ---: | ---: | ---: |
| 5,000 | $287.50 | $77.50 | $210 |
| 50,000 | $2,875 | $775 | $2,100 |
| 500,000 | $28,750 | $7,750 | $21,000 |

Assumed fixed licensing/operations is $1,200/month, so break-even is ~28,600 mixed calls. The sensitive variable is jurisdictional data licensing, followed by classification-review escalation. Acquisition: x402 agent directories, ecommerce/ERP integration examples, a free tariff-revision webhook, and broker partnerships.

## 7. Competitive strength

Material advantages: exact as-of evidence, component formulae, explicit unknowns, and an idempotent packet an agent can attach to a purchase. Positioning starts with U.S. imports where official sources are strong. The data moat is calibration against buyer-supplied final entry summaries (opt-in and anonymized), plus parser tests across revisions. Incumbents can expose APIs; BorderBill stays differentiated by accountless per-call access, multi-provider provenance and a conservative non-binding boundary.

## 8. Feasibility and MVP plan

MVP: Lucid runtime; USITC revision ingester; ITA tariff/FTA adapter; FX adapter; deterministic cost engine with decimal arithmetic; evidence store; optional retrieval for classification candidates. Start with ordinary non-restricted goods and U.S. imports. Sequence: revisions → code lookup → cost formulas → paid endpoints → evidence hashes → optional additional-duty rules.

Tests include effective-date boundaries, specific/ad-valorem/compound rates, currencies, quantities, missing facts, conflicting codes, FTA off/on, stale data, rate-source outage, exact decimals, idempotency, duplicate payment, payment config absent, and route discovery. Legal/licensing risks require counsel-reviewed disclaimers and upstream licences. Product descriptions are untrusted. No dangerous/restricted-product advice. MVP's smallest useful version accepts a buyer-supplied HTS code and computes a cited cost range; classification ranking can be labelled beta.

## 9. Copy-paste-ready Taskmarket build brief

**Task title:** Build BorderBill U.S. landed-cost evidence API with Lucid and x402

**Description:** Implement a TypeScript service that pins USITC tariff revisions, evaluates up to 15 buyer-supplied HTS candidates, and calculates a cited non-binding landed-cost range for ordinary U.S. imports. Every component must expose source, effective date, formula and uncertainty.

**Stack:** exact Lucid `core@5.0.0`, `http@4.0.0`, `payments@5.0.0`; TypeScript, Zod, decimal arithmetic, SQL, object storage.

**Entrypoints:** paid `evaluate-tariff-candidates` ($0.04 + deterministic extras), paid `quote-landed-cost-pack` ($0.075 + dataset extras), free `coverage-and-quote`; all standard Lucid surfaces.

**Deliverables:** source/lockfile, USITC revision pipeline, ITA/FX adapters, schemas, cost engine, evidence artifacts, 50 tariff fixtures, tests, legal boundary document, licence inventory, benchmark, deployment configuration, preview.

**Acceptance:** reproducible results by revision/date; exact decimals; no unsupported component silently zero; ambiguous classification is reported; explicit Base USDC offers; fail closed without payment config; idempotent no-double-charge; sources resolve.

**Automated verification:** known code/rate fixtures, revision rollover, compound duties, FX outage, malicious descriptions, SSRF, partial-data handling, quote expiry, duplicate payment, all standard routes, typecheck/lint/tests.

**Deployment:** Cloudflare Workers/Node plus SQL/object storage. **Out of scope:** filing, broker services, binding rulings, restricted goods, evasion, legal/tax advice. **Suggested bounty:** 3,000 USDC, 30 days, bounty, public/reveal-on-submit, tags `lucid-agents,x402,customs,trade,provenance`.

## 10. Sources and assumptions

Verified:

- ITA tariff/fee explanation and final-determination caveat: https://www.trade.gov/import-tariffs-fees-overview
- USITC HTS archive: https://hts.usitc.gov/download/archive
- CBP ACE capabilities: https://www.cbp.gov/trade/automated/how-to-use-ace
- ITA JSON data APIs: https://www.trade.gov/data
- HS-code overview and CROSS rulings: https://www.trade.gov/harmonized-system-hs-codes

Estimates: price, data licensing, compute, usage, margins, fixed cost and latency. Validate by comparing at least 1,000 historical ordinary-goods scenarios to published schedules and, where volunteered, broker/final-entry outputs. All results remain estimates, not customs determinations.
