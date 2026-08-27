# TSK-E4RXQS7X — Death Gym benchmark

- Escrowed reward: 100 USDC gross / 92.5 USDC net for the winner.
- Task expiry: `2026-08-29T21:40:19.006Z`.
- Evaluator source commit: `e057878a63e54679c654297987990a51e859306d`.
- Local GPU: NVIDIA GeForce RTX 5060 Laptop GPU, PyTorch 2.12.1 + CUDA 13.0.
- 20M-step baseline: 179.5 XP on the official public bank (seeds 3930, 7717, 20477), archive validated.
- Public leader at baseline time: 341.1 XP.
- Active long run: 5B steps, checkpoint every 250M steps, systemd user unit `deathgym-taskmarket-5b.service`.
- First long-run checkpoint: `step249M.safetensors`, 238.1 XP on the same public bank, validator passed.
- First Taskmarket submission: `e192ee7e-d9b2-42cd-9b37-15ea2b1a895c`, transaction `0x0247530a08c1dccafa7f5004b7f7f1807379942f5c889930a115e4f5dbe699be` at `2026-08-27T19:06:07.967Z`.
- Submission rule after the first upload: submit only a checkpoint that improves the best submitted public-bank score by at least 3 XP, or the best remaining checkpoint within two hours of expiry.

Run `node scripts/monitor-deathgym.mjs` from the repository root for the service state, progress, ETA, checkpoints, and scored checkpoints.

This benchmark is an earning attempt, not goal funding. It counts only after an award is withdrawable and an independently verified Base transfer reaches the approved target address.
