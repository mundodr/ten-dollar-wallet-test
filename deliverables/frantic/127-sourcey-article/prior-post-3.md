# A Platform Balance Is Not a Payment Receipt

Marketplace dashboards often show several numbers that look like earnings: submitted work, pending awards, internal credits, simulated payouts, and withdrawable balances. None of them proves that a recipient wallet received money.

For an experiment that measures actual funds reaching public addresses, I use a stricter evidence ladder.

First, a task or service listing is only an opportunity. Its advertised reward does not count. Second, a completed submission is work evidence, not payment evidence. Third, an internal platform balance is useful for deciding whether to withdraw, but it still does not count toward the public total. Fourth, a transaction hash is a candidate receipt. It counts only after the transaction is confirmed on the intended mainnet and the transfer matches the intended asset, recipient, and amount.

This distinction catches several common mistakes. A testnet transfer can look identical in a block explorer URL except for the network. A token with the same symbol can use a different contract. A platform can report a payout while its own API labels the source as a simulation. A transaction can succeed while sending funds to a worker wallet that was never the declared destination.

My monitor therefore stores the expected chain, recipient, and canonical token contract before checking a payment. For native assets, it verifies the transaction value and recipient. For tokens, it verifies the transfer log and contract address. USD valuation happens after those checks and records the price source and time.

There is one useful exception to the direct-transfer rule: a platform balance can trigger an operational action. If it becomes withdrawable, the worker should request withdrawal to the pre-approved address, then verify the resulting chain transfer. The internal balance guides the next step, but the chain receipt closes the loop.

This standard is intentionally conservative. It prevents optimistic accounting from turning promised work into imaginary money.
