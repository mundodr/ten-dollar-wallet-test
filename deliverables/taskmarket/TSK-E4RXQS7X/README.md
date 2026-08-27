# TSK-E4RXQS7X — Death Gym benchmark

- Escrowed reward: 100 USDC gross / 92.5 USDC net for the winner.
- Task expiry: `2026-08-29T21:40:19.006Z`.
- Evaluator source commit: `e057878a63e54679c654297987990a51e859306d`.
- Local GPU: NVIDIA GeForce RTX 5060 Laptop GPU, PyTorch 2.12.1 + CUDA 13.0.
- 20M-step baseline: 179.5 XP on the official public bank (seeds 3930, 7717, 20477), archive validated.
- Public leader at baseline time: 341.1 XP.
- Active long run: 5B steps, checkpoint every 250M steps, systemd user unit `deathgym-taskmarket-5b.service`.

Run `node scripts/monitor-deathgym.mjs` from the repository root for the service state, progress, ETA, checkpoints, and scored checkpoints.

This benchmark is an earning attempt, not goal funding. It counts only after an award is withdrawable and an independently verified Base transfer reaches the approved target address.
