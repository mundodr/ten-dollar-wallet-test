# TSK-E4RXQS7X — Death Gym benchmark

- Escrowed reward: 100 USDC gross / 92.5 USDC net for the winner.
- Task expiry: `2026-08-29T21:40:19.006Z`.
- Evaluator source commit: `e057878a63e54679c654297987990a51e859306d`.
- Local GPU: NVIDIA GeForce RTX 5060 Laptop GPU, PyTorch 2.12.1 + CUDA 13.0.
- 20M-step baseline: 179.5 XP on the official public bank (seeds 3930, 7717, 20477), archive validated.
- Current observed public leader: 347.4 XP.
- Active long run: 5B steps, checkpoint every 250M steps, systemd user unit `deathgym-taskmarket-5b.service`; `deathgym-taskmarket-5b.timer` restores the newest stable checkpoint after interruption or reboot.
- Automatic continuation: after the 5B final checkpoint exists, `deathgym-taskmarket-9b.timer` starts `scripts/run-deathgym-continuation.mjs`, which resumes toward 9B steps and, after an interruption, selects its newest saved 9B checkpoint. Nine billion is the largest target projected to finish safely before expiry at the observed throughput.
- First long-run checkpoint: `step249M.safetensors`, 238.1 XP on the same public bank, validator passed.
- First Taskmarket submission: `e192ee7e-d9b2-42cd-9b37-15ea2b1a895c`, transaction `0x0247530a08c1dccafa7f5004b7f7f1807379942f5c889930a115e4f5dbe699be` at `2026-08-27T19:06:07.967Z`.
- Second long-run checkpoint: `step499M.safetensors`, 255.9 XP on the same 49,152-world public bank, validator passed; immutable archive SHA-256 `fdcf56be4e41b1b1a0755bd6f1efdb4f224fb42997e51cf2a8801ab5097f3ed3`.
- Second Taskmarket submission: `daa17e53-320b-43cf-9435-6b7ce606c2ba`, transaction `0xb5a1bf09a8a51dfb7992f02c47ff0e69b5ebd6ce2333f8b5167161a805283a55` at `2026-08-27T20:14:55.360Z`.
- Third long-run checkpoint: `step749M.safetensors`, 263.5 XP on the same public bank, validator passed; immutable archive SHA-256 `f898e1db0b4158280565e76c7ecf533d7ac0b88bcf4f8adb3b8e13113fb768b2`.
- Third Taskmarket submission: `e924b0e2-b5df-4276-a354-43708faec83f`, transaction `0xd30b7d47e99495147f11345d08f07318a51c6c466c7362e37f0780b23a5efdb2` at `2026-08-27T21:37:00.172Z`.
- Fourth long-run checkpoint: `step999M.safetensors`, 272.6 XP on the same public bank, validator passed; immutable archive SHA-256 `e314dcd3ab9f690476eeaea45fab9104431996ced3116a3a8c02c18cf703b397`.
- Fourth Taskmarket submission: `f248bcfa-d8f7-46c4-aedd-b4161da4da00`, transaction `0x20b2ee5fac5de71676b19134587789dd9fa88f904e56f700f2df0bdfc758e301` at `2026-08-27T22:58:48.203Z`.
- Fifth long-run checkpoint: `step1249M.safetensors`, 284.4 XP on the same public bank, validator passed; immutable archive SHA-256 `2df5a03cc44f73f47399a5b4e5722fe259e382d5a793387406f8e515e5a650b7`.
- Fifth Taskmarket submission: `fc8f652b-a6bb-44e3-bef1-027c7880efb1`, transaction `0x68b54e19735adf739932a947e122f3d02bf9f5965a28f411127979311bdf4fcf` at `2026-08-28T00:23:21.811Z`.
- Current local best: a validator-passing weighted model soup of the 1,249M, 1,499M, and 1,749M checkpoints at weights 0.40 / 0.20 / 0.40 scored 290.1 XP on the full 49,152-world public bank. Its per-seed means are 289.0, 291.5, and 289.9 with zero truncated worlds; archive SHA-256 `db05f83ead30d8d28db34a204f6c8bef043dd64de6a775639d7f782b7aca863f`. It improves the prior equal-weight soup's 289.4 XP but remains local because the official submit route currently requires acceptance of an age-capacity-gated draft legal bundle and a 0.001 USDC x402 charge.
- Submission rule after the fifth upload: submit only a checkpoint that improves the best submitted public-bank score by at least 3 XP (currently at least 287.4 XP), or the best remaining unsubmitted checkpoint within two hours of expiry.
- Checkpoint automation: `deathgym-taskmarket-checkpoints.timer` runs every five minutes. It locates the newest stable checkpoint across `long-5b` and `long-9b`, evaluates each archive once, validates its exact SHA-256, and requires an authenticated task-specific Taskmarket artifact readback after any submission. The cross-task submission projection is not used for idempotency because benchmark rows there can lag and omit artifact metadata. A Taskmarket outage fails closed and is retried by the timer.

Run `node scripts/monitor-deathgym.mjs` from the repository root for the service state, progress, ETA, checkpoints, scored checkpoints, and independently published leaderboard rows keyed by worker address and archive hash.

This benchmark is an earning attempt, not goal funding. It counts only after an award is withdrawable and an independently verified Base transfer reaches the approved target address.
