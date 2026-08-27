# Fail-Soft Fetching Without Hiding the Failure

An endpoint that aggregates several public APIs has two bad extremes. It can fail the whole request when one dependency times out, or it can silently replace every error with a plausible value. The first choice is brittle. The second is misleading.

For a small multi-network balance monitor, I use a bounded fail-soft pattern. Each upstream request has a seven-second timeout. Independent calls run concurrently. A failed balance call returns a numeric zero so the response remains usable. A failed market-price call uses a fixed fallback table and marks the price block with `estimated: true`.

That last field matters more than the fallback values. Without it, a caller cannot tell whether the response reflects a live quote or an old emergency constant. With it, the caller can decide whether to display an estimate, postpone a calculation, or reject the response.

The pattern still needs discipline:

1. Timeouts must be explicit. Waiting on a default socket timeout can stall the whole aggregate request.
2. Fallbacks must be visible in the response. A hidden fallback is fabricated freshness.
3. Concurrent work must remain independent. One rejected promise should not cancel unrelated successful results.
4. Cache headers must match the data. A response based on minute-scale balances should not be cached for a day.
5. The API needs a deterministic example response so documentation and tests agree on types.

I also avoid retry storms inside the request path. If four clients each trigger three retries against a degraded RPC, a minor outage becomes self-inflicted load. One bounded attempt per upstream is easier to reason about. A separate monitor can retry on its own schedule and report the incident.

Fail-soft code should preserve useful partial data, not erase uncertainty. The consumer deserves both the number and the reason it may be incomplete.
