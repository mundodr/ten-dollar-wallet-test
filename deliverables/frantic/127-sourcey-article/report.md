# Frantic bounty 127 delivery report

- Platform and byline: Medium profile `https://medium.com/@ten-dollar-wallet-lab` under `Ten Dollar Wallet Lab`; the final article is still pending.
- Topic: generating a documentation site from an OpenAPI source with the open-source Sourcey generator.
- Reproduction: `npx --yes sourcey@3.6.5 validate openapi.yaml` reported one operation and five schemas, then the pinned build completed in 0.9 seconds.
- Dated sources: the article links the official OpenAPI integration guide, official introduction, and official Sourcey repository, all checked on 2026-08-27 UTC.
- Generated evidence: the build produced nine files including static HTML, search data, `llms.txt`, and `llms-full.txt`.
- Word count: 892 words by `wc -w` in the article source before Medium rendering.
- Prior-post count: two publicly retrievable earlier articles. The third is saved as Medium draft `621e00f86602`; Medium's rolling two-story limit permits the next attempt after 2026-08-28 19:02 UTC.

## Prepared publication text

This section is the immutable candidate copy. It must not be described as published until the exact title and public URL appear in Medium's RSS feed.

# From One OpenAPI File to a Searchable Static Docs Site

My test project has one read-only endpoint and an awkward data model. It combines native balances and stablecoin balances from Solana, BNB Smart Chain, Base, and TRON, then returns a dated USD estimate. The handler is short, but a useful contract has to explain nine balance fields, four price fields, fallback behavior, caching, and the fact that every upstream can fail independently.

I wanted documentation that was generated from the contract instead of a second hand-written description. On 27 August 2026, I tested Sourcey 3.6.5 against the real endpoint schema in the project. The full OpenAPI file and generated output are public with the project, so every result below can be reproduced.

## 1. Describe the behavior, including the uncomfortable parts

The endpoint is `GET /api/progress`. Its success response contains five top-level fields: `balances`, `prices`, `usdTotal`, `percent`, and `updatedAt`.

The OpenAPI 3.1 file defines five schemas. `ProgressSnapshot` is the root. `Balances` requires all nine asset fields. `Prices` requires the four native-asset prices and an `estimated` boolean. Two small shared schemas enforce non-negative balances and positive prices.

The description also states the fail-soft rule plainly. A failed upstream balance lookup becomes zero, which preserves the response shape but can understate a wallet during an outage. The price block exposes whether fixed fallback values were used. That behavior belongs in the contract because a schema that only lists types would make the response look more certain than it is.

The official [OpenAPI integration documentation](https://sourcey.com/docs/openapi-integration) said, when checked on 27 August 2026, that OpenAPI 3.0, 3.1, and 3.2 are supported natively, while Swagger 2.0 is converted during the build. It also listed YAML, JSON, and URL inputs. My input was a local YAML file using OpenAPI 3.1.

## 2. Validate before building

I pinned the package version in the command so a later release cannot silently change this reproduction:

```bash
npx --yes sourcey@3.6.5 validate openapi.yaml
```

The validator returned:

```text
Valid: Ten Dollar Wallet Progress API v1.0.0
Operations: 1
Schemas:    5
```

This check is worth keeping separate from site generation. A documentation build should not become the first place a broken reference or malformed schema is noticed. The same official integration page stated on the checked date that validation parses, dereferences, and normalizes the spec before reporting structural problems.

## 3. Build a disposable output directory

The complete build command was:

```bash
npx --yes sourcey@3.6.5 build openapi.yaml -o dist
```

The build completed in 0.9 seconds on this machine. It reported one operation and five schemas, matching validation. The output contained nine files: two HTML entry points, one CSS file, one small JavaScript file, a search index, a sitemap, an Open Graph image, `llms.txt`, and `llms-full.txt`.

The generated page gave the progress operation its own sidebar entry and rendered all five models. It also generated request examples for cURL, JavaScript, and Python. That matches another dated fact from the [OpenAPI integration page](https://sourcey.com/docs/openapi-integration): the default code-sample set was cURL, JavaScript, and Python on 27 August 2026, with additional languages available through configuration.

One detail from the actual output is useful. My server URL uses an OpenAPI variable named `origin` with a local default. Sourcey kept `{origin}` visible in the generated snippets instead of pretending that the endpoint already had a permanent public API origin. That is the honest result for a project whose dynamic route runs from a local checkout while its public project page is static.

## 4. Inspect the output as files, not as a hosted dashboard

The generated `index.html` was about 161 KB and the shared stylesheet about 123 KB. Search data lived in `search-index.json`. Both portable context files were plain text and readable without executing the site.

The official [Sourcey introduction](https://sourcey.com/docs/introduction) said on the checked date that a build writes static HTML, a CSS file, and a small script used for search and dark mode. The same page documented `llms.txt` and `llms-full.txt` as context outputs derived from the documentation source. My directory contained both files after the single build command.

The project also publishes Sourcey under the AGPL-3.0 license, as recorded in its [official source repository](https://github.com/sourcey/sourcey) when checked on 27 August 2026. That matters for this workflow because the generated site can live beside the application source, and the build does not depend on a private documentation account.

## 5. Test the generated contract against the handler

Generation proves that the specification is readable. It does not prove that the implementation returns what the specification promises.

I compared every required response property with the TypeScript handler. All nine documented balance keys are returned. All five price properties are returned. `percent` is capped at 100. `updatedAt` is an ISO timestamp. The handler sends `cache-control: public, max-age=30, s-maxage=60`, which is also documented as a response-header example.

There is one gap worth recording. The handler currently collapses a failed balance lookup to zero without returning per-source status. The OpenAPI description discloses that rule, but a future version should add a `sources` object with an explicit status for each RPC. That change would preserve the stable numeric shape while letting clients separate an empty balance from an unavailable upstream.

The next build will be triggered only after that new status object exists in both the handler and the OpenAPI file. The test will compare their JSON paths before the generated site is published again.
