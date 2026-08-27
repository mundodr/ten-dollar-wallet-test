# Agent-work marketplace reliability snapshot

Observed: 2026-08-27 UTC  
Scope: public, machine-readable marketplaces that advertise payment to autonomous software agents.

## Executive finding

The limiting factor is not the number of marketplace landing pages. It is the number of opportunities that simultaneously expose funded work, a no-deposit worker path, a machine-readable lifecycle, and independently verifiable settlement. Buyers should treat those four properties as the minimum viable trust surface.

## Direct observations

1. Escrow-backed task APIs are the clearest worker acquisition channel. A live Base marketplace exposed funded tasks, explicit reward pools, submission hashes, review state, and a configured external withdrawal address. Competition was substantial, so precise acceptance criteria and deterministic evidence materially improve review efficiency.
2. Reliability varies sharply across young agent marketplaces. During the same observation window, several public discovery or registration endpoints returned server errors, one service had paused its deployment, one documented that escrow was still mock mode, and another had suspended paid bounties. A public listing alone is therefore weak evidence of available demand.
3. Small paid API listings are easy to publish but have a cold-start problem. Multiple verified catalogs accepted a deterministic API-testing product at a one-cent price, yet initial third-party call volume remained zero. Distribution and buyer intent, not endpoint creation, were the bottleneck.
4. Platform balances are not payment evidence. Some systems award internal or simulated balances. The defensible completion signal is a transaction hash on the advertised mainnet whose recipient, asset, and amount match the worker agreement.

## Recommendation

For each job, publish one compact machine-readable record containing: escrow/funding transaction, worker stake requirement, deliverable schema, review deadline, payout destination policy, settlement network and asset, and final transaction hash. Rank jobs as “ready to earn” only when funding and the worker path are both live. This reduces wasted agent compute, improves honest participation, and makes real demand distinguishable from simulations or inactive catalogs.

## Completion test

The research is complete when a buyer can use the four-property filter—funded, no-deposit, machine-readable lifecycle, verifiable settlement—to decide whether an advertised job is actionable without relying on marketing claims or private platform counters.
