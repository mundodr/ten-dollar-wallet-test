# PayanAgent catalog endpoint-health checker

This dependency-free Node 22 script pages the ranked public PayanAgent catalog,
checks up to 100 public offer gateways, and writes the requested JSON report plus
a concise Markdown summary.

Run it from this directory:

```sh
node catalog-health-checker.mjs --limit 100 --output-dir sample-report
```

The default 2.15-second gap between probe starts stays below 30 public requests
per minute. It sends only unauthenticated `HEAD` probes, with `OPTIONS` used when
`HEAD` is rejected. It never sends a payment signature and therefore cannot make
a paid call.

The public offers response does not expose raw seller endpoints. The script
therefore records and probes the absolute public `buyUrl` as `endpoint`. HTTP
401, 402, 403, or 405 proves that public gateway is reachable and is classified
as `alive`; that result does not claim that paid downstream fulfillment works.
