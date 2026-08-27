# GridShift: carbon-and-cost dispatch packets for flexible compute

## 1. Product thesis

**GridShift** sells an executable scheduling decision for flexible AI/batch workloads: choose when and where to run under a deadline, region allowlist, energy/carbon objective, data-residency rule, and maximum migration cost. The buyer is a cloud scheduler, training agent, render farm, CI orchestrator, or inference batcher—not a human browsing a carbon dashboard.

The expensive recurring problem is joining electricity/emissions forecasts with workload constraints and preserving evidence for the decision. x402 is native to the event: one workload produces one dispatch packet, so occasional or cross-organization buyers need neither a subscription nor a persistent API credential.

## 2. Buyer workflow and usefulness

- **Trigger:** a deferrable job enters a queue or an existing job becomes movable.
- **Action:** run now, defer to a bounded window, or move to another approved region.
- **Frequency:** one call per queued batch plus one post-run attestation; 100–1,000,000/month.
- **Measurable value:** estimated grams CO2e and electricity cost avoided versus the declared baseline, deadline success rate, and percent of recommendations actually executed.

Evidence:

- The Green Software Foundation describes shifting software to times/locations with cleaner electricity, including AI training and deployments: https://carbon-aware-sdk.greensoftware.foundation/docs/overview
- Its Carbon Aware Web API exposes carbon intensity and forecast operations: https://carbon-aware-sdk.greensoftware.foundation/docs/tutorial-basics/carbon-aware-webapi
- EIA provides free hourly balancing-authority demand, forecast, generation and interchange data: https://www.eia.gov/opendata/index.php/api
- The Carbon Aware SDK requires a configured real source; its default random data is not real carbon data, which illustrates the provenance gap a paid packet must close: https://carbon-aware-sdk.greensoftware.foundation/docs/quickstart

## 3. Endpoint product

One server-only runtime pins `@lucid-agents/core@5.0.0`, `@lucid-agents/http@4.0.0`, and `@lucid-agents/payments@5.0.0`.

### Paid entrypoint A — `choose-compute-window`

- **Path/purpose/buyer:** `POST /api/agent/entrypoints/choose-compute-window/invoke`; rank feasible region/time slots for a prospective job; bought by schedulers.
- **Request:** `{workload:{estimatedKwh,durationMinutes,earliest,deadline}, regions:[{id,gridZone,dataResidency,transferGb?,computePriceUsdPerHour?}], objective:{carbonWeight:0..1,costWeight:0..1}, baseline:{region,start}, maxTransferUsd?, forecastConfidenceMin?}`
- **Example:** `{"workload":{"estimatedKwh":18,"durationMinutes":120,"earliest":"2026-08-27T18:00:00Z","deadline":"2026-08-28T06:00:00Z"},"regions":[{"id":"us-east","gridZone":"PJM","dataResidency":"US"},{"id":"us-west","gridZone":"CISO","dataResidency":"US","transferGb":40}],"objective":{"carbonWeight":0.7,"costWeight":0.3},"baseline":{"region":"us-east","start":"2026-08-27T18:00:00Z"},"maxTransferUsd":5}`
- **Response:** `{forecastIssuedAt,expiresAt,recommendation:{region,start,end,score},alternatives[],baseline,estimatedDelta:{gramsCo2e,costUsd},constraintsChecked[],evidence[],confidence}`
- **Example:** `{"recommendation":{"region":"us-west","start":"2026-08-28T02:00:00Z","end":"2026-08-28T04:00:00Z","score":0.84},"estimatedDelta":{"gramsCo2e":-3920,"costUsd":-0.61},"constraintsChecked":["deadline","US residency","transfer cap"],"confidence":0.79}`
- **Price:** `$0.008 + $0.001 × regionCount`, capped at $0.02; Base USDC.
- **SLO/data:** p95 <2 s; forecast age shown, normally ≤15 minutes; 99.5% API target.
- **Dependencies/errors:** configured emissions forecast, EIA/grid telemetry, buyer-supplied cloud price, deterministic optimizer. `NO_COMMON_WINDOW`, `STALE_FORECAST`, and `UNKNOWN_ZONE` are typed. Never fabricate missing energy prices. Idempotency keys bind forecast snapshot and request.

### Paid entrypoint B — `attest-dispatch-outcome`

- **Path/purpose:** `POST /api/agent/entrypoints/attest-dispatch-outcome/invoke`; calculate a post-run evidence receipt from metered start/end/energy, distinct from prospective optimization.
- **Request:** `{decisionId, actual:{region,start,end,energyKwh,providerMeterRef?}, baselineMode:"original"|"nearest-feasible", includeSignedReceipt:boolean}`
- **Example:** `{"decisionId":"gs_123","actual":{"region":"us-west","start":"2026-08-28T02:03:00Z","end":"2026-08-28T04:01:00Z","energyKwh":17.6},"baselineMode":"original","includeSignedReceipt":true}`
- **Response:** `{actualIntensitySeriesHash,actualGramsCo2e,baselineGramsCo2e,avoidedGramsCo2e,methodVersion,dataSources,uncertainty,receiptJws}`
- **Price:** $0.025 for ≤24 hours of telemetry; $0.001/additional hour, max $0.10.
- **SLO/data:** p95 <3 s after telemetry availability; all timestamps and units explicit. A gap returns an uncertainty range, not interpolation disguised as observation.
- **Dependencies/errors:** historical emissions data, receipt signer/HSM. Duplicate decision+actual hash returns same receipt; contradictory replay is 409.

### Free and shared surfaces

`coverage-preview` returns zones, forecast timestamps, method version, pricing and a coarse no-decision sample. The runtime mounts `GET /api/agent/health`, `GET /api/agent/entrypoints`, `POST /api/agent/entrypoints/:key/invoke`, `POST /api/agent/entrypoints/:key/stream`, `/api/agent/.well-known/agent-card.json`, `/api/agent/.well-known/agent.json`, and `/api/agent/.well-known/oasf-record.json`. Paid operations explicitly advertise x402; absent configuration fails closed.

Entities: `Workload`, `Region`, `ForecastSnapshot`, `DispatchDecision`, `MeterReading`, `Attestation`. Buyer provides no cloud credentials; region identifiers and optional public meter references only. Enforce residency allowlists, bounded time horizons, unit schemas and no job movement. Non-goals: controlling cloud resources, claiming regulatory-grade carbon accounting, purchasing energy, or optimizing workloads with safety-critical deadlines.

## 4. x402 payment design

Settle in exact Base USDC. Price is deterministic from region count or telemetry hours and included in free discovery. Payment binds the immutable forecast snapshot; if the forecast expires before processing begins, refund or require a new offer. Duplicate keys retrieve the same packet without another payment. If paid upstream data fails, return no decision and credit/refund. A post-run receipt remains retrievable indefinitely by hash. Bundles may reduce price for high-frequency schedulers, but the accountless single call remains first-class. No outcome-based pricing because the service cannot observe all cloud cost/carbon variables reliably.

## 5. Market analysis

Beachhead: CI, batch inference, rendering and training queues that already have multiple approved regions and deferrable deadlines. Timing is supported by established carbon-aware tooling and agentic schedulers that can consume JSON decisions.

Alternatives:

1. **Green Software Foundation Carbon Aware SDK** — open toolkit and Web API, but users configure/operate a data source and their own cost/constraint optimizer.
2. **Electricity Maps API** — emissions/energy data provider: https://www.electricitymaps.com/platform/api
3. **WattTime** — marginal emissions data and automated emissions reduction: https://watttime.org/data-science/data-signals/
4. Cloud-native carbon dashboards — report provider footprints but do not necessarily sell a cross-cloud per-job decision receipt.

GridShift's wedge is combining buyer constraints, carbon, cost and evidence in one purchase. Its moat is forecast-performance calibration, zone/region mappings, receipt methods and observed decision outcomes. Data vendors may add optimization; GridShift stays multi-source and transparent about uncertainty.

## 6. Unit economics and profitability

Estimated representative economics:

| call | revenue | upstream | compute/storage/signing | gross profit | margin |
| --- | ---: | ---: | ---: | ---: | ---: |
| 4-region decision | $0.012 | $0.0030 | $0.0010 | $0.0080 | 67% |
| 24h attestation | $0.025 | $0.0050 | $0.0015 | $0.0185 | 74% |

At 80/20 decision/attestation:

| calls/month | revenue | variable cost | gross profit |
| ---: | ---: | ---: | ---: |
| 20,000 | $292 | $92 | $200 |
| 200,000 | $2,920 | $920 | $2,000 |
| 2,000,000 | $29,200 | $9,200 | $20,000 |

Assumed fixed data/infra/operations: $1,000/month; break-even ~100,000 mixed calls. Upstream forecast licensing is the sensitive variable. Distribution: x402 catalogs, Kubernetes/Argo and CI examples, open-source policy client, and a free zone/freshness endpoint.

## 7. Competitive strength

The service is materially better than raw intensity data for an agent because it returns a constraint-checked action and a comparable post-run receipt. The initial wedge is “one paid decision, no carbon-data account.” Provenance, calibrated uncertainty, buyer-executed feedback and stable signed receipts form the moat. If cloud providers expose equivalent dispatch APIs, GridShift can remain a cross-cloud evaluator and independent evidence layer.

## 8. Feasibility and MVP plan

Architecture: Lucid runtime; adapters for EIA plus one licensed forecast source; region-zone registry; deterministic window optimizer; decimal/unit library; snapshot store; JWS receipt signer. Start with 10 U.S. regions and buyer-supplied compute prices. Sequence: source ingestion → constraints/optimizer → decision endpoint → historical join → receipt endpoint → calibration dashboard.

Tests: timezone/DST, no feasible window, forecast expiry, missing zones, mixed units, cost/carbon weights, residency constraints, telemetry gaps, baseline selection, receipt signature, idempotency, payment failure/duplicate and all standard routes. Data licences and signal semantics must be documented; average vs marginal emissions cannot be mixed. The smallest useful MVP chooses among two regions in a 24-hour window with cited intensity. No automatic cloud action.

## 9. Copy-paste-ready Taskmarket build brief

**Task title:** Build GridShift Lucid x402 carbon-aware compute dispatcher

**Description:** Build a TypeScript API that recommends a feasible region/time for a bounded compute job using fresh emissions data, buyer prices and explicit constraints, then issues a signed post-run carbon comparison receipt.

**Stack:** `@lucid-agents/core@5.0.0`, `@lucid-agents/http@4.0.0`, `@lucid-agents/payments@5.0.0`, TypeScript/Zod, SQL/KV, configured carbon data adapter, JWS signer.

**Entrypoints:** paid `choose-compute-window` with region-count rule; paid `attest-dispatch-outcome` with telemetry-hour rule; free `coverage-preview`; standard Lucid routes.

**Deliverables:** source, lockfile, source adapters, region registry, optimizer, schemas, receipt verifier, provenance store, fixtures, tests, calibration/cost worksheet, deployment config, public preview.

**Acceptance:** constraints never violated; stale/missing data never becomes zero; source/signal/method version reported; deterministic price and idempotency; explicit Base USDC offer; fail closed without payment; signed receipt verifies independently.

**Automated verification:** DST/units, stale forecast, infeasible deadline, telemetry gaps, method mismatch, signature tamper, duplicate payment, all discovery/invoke routes, lint/typecheck/test.

**Deployment/out of scope:** Cloudflare/Node with SQL/KV and HSM-compatible key. No cloud control, energy trading, safety-critical scheduling, or regulatory assurance. **Suggested bounty:** 1,800 USDC, 21 days, bounty, public/reveal-on-submit, tags `lucid-agents,x402,carbon-aware,cloud,scheduling`.

## 10. Sources and assumptions

Verified:

- Carbon-aware use cases and tooling: https://carbon-aware-sdk.greensoftware.foundation/docs/overview
- Carbon Aware Web API: https://carbon-aware-sdk.greensoftware.foundation/docs/tutorial-basics/carbon-aware-webapi
- EIA hourly operating data: https://www.eia.gov/opendata/index.php/api
- EIA grid route details: https://www.eia.gov/opendata/browser/electricity/rto

Estimates: call rates, prices, source costs, margins, fixed cost, forecasts and latency. Validate signal licensing and compare recommendations against historical windows before launch. “Avoided” emissions are modeled counterfactuals, not guaranteed physical reductions.
