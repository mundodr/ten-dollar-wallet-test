# Inference Index — reviewer handoff

Public preview: https://inference-index-v6.radearthonline.chatgpt.site

## What is delivered

- Next.js App Router + TypeScript editorial website: landing leaderboard, methodology, API, and updates.
- Filter controls for workload, scenario, accuracy target, submitter, vendor, metric view, and search.
- One canonical Lucid runtime using `@lucid-agents/core@5.0.0`, `http@4.0.0`, and `payments@5.0.0`; Next route modules delegate directly to `runtime.http.handlers`.
- Free status/preview and Base Sepolia x402 rank/compare entrypoints at the required prices.
- Deterministic fixture and full-source allowlist pipeline with reviewed registries, Zod validation, content-addressed entities, atomic promotion, quarantine, coverage, tombstones, changelog, and expected hashes.
- Complete source, lockfile, tests, CI, data/source/payment/update/rollback/deployment documentation, and verification report.

## Verified data

- Exact slice: MLPerf Inference v6.0 / Closed / gpt-oss-120b / Offline / default accuracy / tokens per second.
- Three valid published records across NVIDIA, AMD, and Intel and three accelerator families.
- One deliberately ambiguous accelerator-count fixture is `review-required` and excluded.
- Pinned upstream commit: `4d3916ac9cf474b679cdfcf492d43a0559418ad1`.
- Dataset hash: `14b79625bffc23fa04b427c66d9d898ae8254e13f90c97609191e35a32e825c4`.

## Verification

- `npm run data:verify`: pass.
- `npm run data:verify:full`: pass.
- `npm run type-check`: pass.
- `npm run lint`: pass.
- `bun test` (Bun 1.4.0): 13 pass, 0 fail.
- `bun run build`: pass.
- Public anonymous checks: home, methodology, API, updates, health, entrypoints, and both agent-card aliases return 200.
- Free preview returns 200 with provenance. Unpaid rank returns 402 with a 0.02 USDC Base Sepolia offer and the configured public destination.

The preview is public and intended to remain online for at least seven days after review. Mainnet payments are intentionally out of scope.
