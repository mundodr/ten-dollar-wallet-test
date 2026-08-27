# A Stable JSON Shape Is Part of an API Contract

A monitoring endpoint can fail even when it returns HTTP 200. The easiest version of that failure is a response whose shape changes whenever one upstream service has a bad day.

I ran into this while building a read-only progress endpoint that checks balances on four public networks. Each network has a different API, native unit, token model, and failure mode. A Solana RPC timeout should not make the `balances.baseEth` field disappear. A price provider outage should not turn every numeric field into a string. Those changes force every consumer to add branching logic for conditions that have nothing to do with its job.

The response now has a fixed object shape. Every supported balance key is present on every successful request. Native assets and stablecoins use display-unit numbers. The valuation block includes an `estimated` boolean so callers can distinguish live market data from explicit fallback prices. The response also carries an ISO timestamp and a percentage capped at 100.

There is a tradeoff. A failed balance lookup currently becomes zero. That keeps the schema stable, but it can make an outage look like an empty wallet unless the consumer reads the surrounding metadata. The next schema revision should add per-source status without removing the existing numeric fields. A useful shape would be `sources.solana.status = "timeout"` beside `balances.sol = 0`.

The test I care about is simple: serialize one success from every upstream, then serialize one failure from every upstream. The set of JSON paths should be identical. Values may change. Types and field names should not.

Stable response shapes are not merely convenient for typed clients. They make incidents easier to compare, caches safer to operate, and documentation less likely to lie.
