# Public JSON API extraction sample

A standard-library-only Python pipeline for one explicitly authorized public
JSON endpoint. It validates the destination before fetching, rejects redirects,
bounds response size and time, requires JSON content, selects a record list,
exports deterministic JSON or flat CSV, and re-reads the output for validation.

## Safety boundary

- HTTPS only.
- The operator must pass the exact public hostname with `--allow-host`.
- DNS results must be globally routable; loopback, private, link-local, and
  reserved addresses are rejected.
- Redirects, URL credentials, authentication headers, browser sessions,
  paywall bypass, and private data are deliberately unsupported.

This sample is suitable for public or buyer-authorized JSON APIs. It is not a
general-purpose crawler and does not bypass access controls or site policies.

## Run

```bash
python3 public_json_extractor.py \
  'https://api.example.com/v1/items' output.json \
  --allow-host api.example.com --format json --records-path data.items
```

For a flat list of scalar objects, use `--format csv` to produce a stable
column order and validate the final row count.

## Test

```bash
python3 -m unittest -v
```

Seven tests cover HTTPS enforcement, exact allowlisting, private-network
rejection, header discipline, content-type validation, nested record selection,
and revalidated CSV output. They use local fakes and make no network requests.
