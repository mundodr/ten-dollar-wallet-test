# ReturnRoute: per-item reverse-logistics disposition and route quotes

## 1. Product thesis

**ReturnRoute** helps a retail, rental or asset-recovery agent decide whether a returned item should be restocked, repaired, refurbished, resold, donated, recycled or disposed, and then obtains a constraint-checked route for that decision. It is not a generic shipping-rate API: the product joins item condition, resale value, recall status, data-wipe/hazard rules, carrier/recycler capability and cost into a per-item economic choice.

The buyer is an autonomous returns or IT-asset agent. x402 is suitable because every return is a new transaction and many small sellers cannot justify contracts with a full returns platform. The buyer can pay cents only when a disposition decision or multi-provider route is needed.

## 2. Buyer workflow and usefulness

- **Trigger:** a return is scanned, a rental retires, or a device fails inspection.
- **Action:** choose disposition, produce packing/wipe/handling requirements, and select the lowest-valid route.
- **Frequency:** one decision per item and one route quote per non-restock item.
- **Measurable value:** recovery value minus processing/shipping cost, landfill avoidance, decision latency, and percent of routes completed without reclassification.

Evidence:

- EPA describes collection, reuse, refurbishing, resale and recycling as distinct electronics lifecycle routes: https://www.epa.gov/electronics-batteries-management/electronics-basic-information-research-and-initiatives
- EPA's waste hierarchy prioritizes source reduction/reuse and then recycling: https://www.epa.gov/smm/sustainable-materials-management-non-hazardous-materials-and-waste-management-hierarchy
- USPS exposes rate calculation from package weight/dimensions and documents HS-code requirements for some destinations: https://www.usps.com/business/web-tools-apis/rate-calculator-api.htm
- Refrigerant-containing appliances have special recovery/disposal responsibilities: https://www.epa.gov/section608/stationary-refrigeration-safe-disposal-requirements

## 3. Endpoint product

One server-only runtime pins `@lucid-agents/core@5.0.0`, `@lucid-agents/http@4.0.0`, and `@lucid-agents/payments@5.0.0`.

### Paid entrypoint A — `choose-item-disposition`

- **Path/purpose:** `POST /api/agent/entrypoints/choose-item-disposition/invoke`; compare feasible value-recovery paths, not book shipping.
- **Buyer:** returns, rental and IT asset agents.
- **Request:** `{item:{category,make?,model?,ageMonths?,condition,working:boolean,cosmeticGrade?,containsBattery?,containsRefrigerant?,dataBearing?:boolean,weightKg,dimensionsCm}, economics:{originalPrice?,estimatedResaleByGrade?,repairQuote?,handlingCost?}, originPostalCode, policy:{minRecoveryUsd?,requireCertifiedRecycler?:boolean,noLandfill?:boolean}}`
- **Example:** `{"item":{"category":"laptop","model":"X1","ageMonths":26,"condition":"screen-cracked","working":true,"containsBattery":true,"dataBearing":true,"weightKg":1.4,"dimensionsCm":[32,22,2]},"economics":{"estimatedResaleByGrade":{"repaired":410,"parts":95},"repairQuote":120},"originPostalCode":"10001","policy":{"requireCertifiedRecycler":true,"noLandfill":true}}`
- **Response:** `{recommendation, alternatives:[{disposition,expectedRecoveryUsd,totalCostUsd,netValueUsd,confidence,requiredSteps,risks,evidence}], excluded:[{disposition,reason}], assumptions,validUntil}`
- **Example:** `{"recommendation":{"disposition":"repair-and-resell","netValueUsd":263,"requiredSteps":["certified data wipe","battery-safe packaging"]},"alternatives":[{"disposition":"parts-resale","netValueUsd":61}],"excluded":[{"disposition":"restock","reason":"condition"}]}`
- **Price:** $0.012 per item, or $0.008/item for content-addressed batches ≥100.
- **SLO/data:** p95 <2 s; value/route inputs timestamped; 99.5% target.
- **Dependencies/errors:** category rules, optional recall screen, buyer value estimates, recycler directory. No resale value is invented; missing values yield ranges/unknown. Idempotency uses item/policy/data snapshot hash.

### Paid entrypoint B — `quote-recovery-routes`

- **Path/purpose:** `POST /api/agent/entrypoints/quote-recovery-routes/invoke`; retrieve and normalize feasible logistics/recycler routes for a selected disposition—different from economic selection.
- **Request:** `{disposition, origin, destinationCandidates?:[{id,postalCode,capabilities}], package:{weightKg,dimensionsCm,battery?,refrigerant?}, serviceDeadline?, requireTracking:boolean}`
- **Example:** `{"disposition":"certified-recycle","origin":{"postalCode":"10001"},"destinationCandidates":[{"id":"r2-1","postalCode":"07001","capabilities":["lithium-battery","data-destruction"]}],"package":{"weightKg":1.8,"dimensionsCm":[40,30,10],"battery":"contained-in-equipment"},"requireTracking":true}`
- **Response:** `{routes:[{provider,service,totalUsd,eta,capabilities,packaging,tracking,evidence,quoteExpiresAt}], rejectedProviders[], bookingInputs, noBookingPerformed:true}`
- **Price:** `$0.02 + $0.004 × queriedProvider`, max $0.06/10 providers.
- **SLO/data:** p95 <4 s; carrier quotes retain their expiry. Dependency failures are per provider; no fabricated fallback. Same quote request is idempotent for provider quote TTL.
- **Dependencies:** USPS/carrier rate APIs, certified recycler endpoints/directories, distance calculation and handling-rule engine. Errors include `NO_COMPLIANT_ROUTE`, `PROVIDER_AUTH_UNAVAILABLE`, `HAZMAT_REVIEW_REQUIRED`.

### Free and shared surfaces

`coverage-quote` returns categories, geographies, provider health, required item fields and price. The runtime mounts `GET /api/agent/health`, `GET /api/agent/entrypoints`, `POST /api/agent/entrypoints/:key/invoke`, `POST /api/agent/entrypoints/:key/stream`, `/api/agent/.well-known/agent-card.json`, `/api/agent/.well-known/agent.json`, and `/api/agent/.well-known/oasf-record.json`. Paid endpoints expose x402 and fail closed without payment config.

Entities: `ReturnedItem`, `Disposition`, `RecoveryEconomics`, `ProviderCapability`, `RouteQuote`, `HandlingRule`. No customer identity is required; item IDs can be buyer-generated hashes. Do not accept photos with people/labels in MVP. No booking, label purchase, resale listing, data wiping or hazardous-material authorization. High-risk items get `human_review`.

## 4. x402 payment design

Exact Base USDC. The decision price is fixed per item/batch; routing price derives from provider count and is quoted before paid calls. Payment and request hashes make retries safe. If every provider is unavailable before work starts, refund; if some respond, return those only when partials were requested and show each failure. Provider quote expiry is never extended. Results remain retrievable free by idempotency key. Volume tiers reflect cache/batch savings, not buyer identity. No percentage of recovered value, which would encourage optimistic valuation.

## 5. Market analysis

Beachhead: small electronics recommerce/rental fleets with item-level condition data but no integrated reverse-logistics optimizer.

Alternatives:

1. **Optoro** — returns/recommerce platform: https://www.optoro.com/
2. **Loop Returns** — merchant returns workflow: https://www.loopreturns.com/
3. **Happy Returns/UPS** — consolidated return locations and reverse logistics: https://happyreturns.com/
4. Carrier rate APIs — route pricing but not disposition economics or certified-recycler constraints.

ReturnRoute's wedge is an accountless per-item decision with explicit non-goals and buyer-supplied values, followed by a valid route. Its moat is outcome calibration by category/condition and a capability-normalized recycler/carrier network. Platforms may expose APIs; a neutral multi-provider router remains useful.

## 6. Unit economics and profitability

Estimated:

| call | revenue | provider/data | compute/storage | gross profit | margin |
| --- | ---: | ---: | ---: | ---: | ---: |
| disposition | $0.012 | $0.0010 | $0.0008 | $0.0102 | 85% |
| 5-provider route | $0.040 | $0.0090 | $0.0015 | $0.0295 | 74% |

At 70/30 mix:

| calls/month | revenue | variable cost | gross profit |
| ---: | ---: | ---: | ---: |
| 20,000 | $408 | $88.2 | $319.8 |
| 200,000 | $4,080 | $882 | $3,198 |
| 2,000,000 | $40,800 | $8,820 | $31,980 |

Estimated fixed provider integrations/operations $1,500/month; break-even ~93,800 mixed calls. Provider rate/licence cost and outcome calibration are sensitive. Distribution: Shopify/marketplace agent examples, ITAD/recycler partnerships, x402 directories and free category coverage.

## 7. Competitive strength

Unlike returns portals, an outside agent can purchase one neutral decision without migrating the whole customer experience. Unlike carrier APIs, it accounts for recovery value, safety and recycler capability. The wedge is electronics “repair vs parts vs certified recycle.” Outcome feedback—actual recovery, route acceptance, reason changes—improves calibration. Incumbents can offer bundled routing; neutrality, evidence and low-volume economics remain defensible.

## 8. Feasibility and MVP plan

Architecture: Lucid runtime; deterministic category/policy engine; buyer value inputs; USPS plus one recycler adapter; quote cache; SQL outcomes; no images. Sequence: laptop/phone fixtures → disposition math → provider capability schema → route adapter → paid handlers → optional recall adapter.

Tests: missing valuations, negative net recovery, policy exclusions, data-bearing steps, batteries/refrigerants, dimension/unit conversion, provider partial outage, quote expiry, batch hashing, malicious text, idempotency, payment duplicate and standard routes. Validate recycler certification data and carrier API terms. The smallest useful MVP handles laptops inside the contiguous U.S. and returns `human_review` for batteries outside supported packaging.

## 9. Copy-paste-ready Taskmarket build brief

**Task title:** Build ReturnRoute Lucid x402 electronics disposition and routing API

**Description:** Build a TypeScript service that chooses among restock/repair/resell/parts/recycle for a returned laptop using buyer-supplied economics and policy, then quotes compliant USPS plus one certified-recycler route without booking.

**Stack:** Lucid `core@5.0.0`, `http@4.0.0`, `payments@5.0.0`; TypeScript/Zod, SQL/KV, provider adapters.

**Entrypoints:** paid `choose-item-disposition` ($0.012/item, batch rule), paid `quote-recovery-routes` (provider-count rule), free `coverage-quote`; all standard Lucid routes.

**Deliverables:** source, lockfile, schemas, economics/policy engine, provider capability model, two adapters, quote cache, fixtures, tests, privacy/threat report, cost benchmark, deployment and preview.

**Acceptance:** no invented resale values; policies enforced; hazardous/unsupported cases escalate; quote source/expiry retained; no booking; explicit Base USDC/fail-closed payment; idempotent no double charge.

**Automated verification:** laptop condition scenarios, battery/data-bearing rules, value sensitivity, unit conversion, provider outage/expiry, batch hash, payment/idempotency and standard routes.

**Deployment/out of scope:** Cloudflare/Node + SQL/KV. No label purchase, shipping booking, resale, data wiping, hazardous authorization, or customer PII. **Suggested bounty:** 1,700 USDC, 21 days, bounty, public/reveal-on-submit, tags `lucid-agents,x402,returns,recommerce,logistics`.

## 10. Sources and assumptions

Verified:

- EPA electronics lifecycle/reuse/refurbish/recycle: https://www.epa.gov/electronics-batteries-management/electronics-basic-information-research-and-initiatives
- EPA waste hierarchy: https://www.epa.gov/smm/sustainable-materials-management-non-hazardous-materials-and-waste-management-hierarchy
- USPS rate API capabilities: https://www.usps.com/business/web-tools-apis/rate-calculator-api.htm
- EPA refrigerant disposal requirements: https://www.epa.gov/section608/stationary-refrigeration-safe-disposal-requirements

Estimates: prices, outcome values, provider costs, volumes, margins, fixed cost and latency. A pilot must measure quote availability and actual recovery variance. Recommendations depend on buyer-supplied condition/value and are not safety or hazardous-shipping certifications.
