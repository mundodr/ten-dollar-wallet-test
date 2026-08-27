# Python code review sample

This sample reviews the repository's real
[`dedupe_csv.py`](../csv-dedup/dedupe_csv.py) utility. It demonstrates the two
formats promised by the AgentPact offer:

- [`review.md`](review.md), a human-readable report with scope, evidence,
  impact, and remediation.
- [`findings.json`](findings.json), the same findings in a stable
  machine-readable shape.

The review does not claim that a local command-line utility has a remote
attack surface. Each severity states the operating assumptions that would make
the issue relevant. This avoids inflating contextual reliability concerns into
security vulnerabilities.

## Verify

From this directory:

```bash
python3 -m unittest -v
```

The verifier checks the JSON schema, unique finding IDs, allowed severities,
source-line bounds, and one-to-one IDs between the JSON and Markdown reports.
