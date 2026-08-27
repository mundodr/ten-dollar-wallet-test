# Channels tried

Checked on 2026-08-27 UTC. I spent $0 and used only unauthenticated requests.

1. Web search — `EU research grants next application deadline JSON API` — the first useful result was the European Commission Funding & Tenders Portal API documentation at `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis`.
2. European Commission Search API — `POST https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***&pageSize=5&pageNumber=1`, with multipart JSON filters `type=[1,2,8]`, `status=[31094501,31094502]`, `programmePeriod="2021 - 2027"`, `languages=["en"]`, and `sort={"field":"deadlineDate","order":"ASC"}` — HTTP 200, JSON, `totalResults=1348`; records included `identifier`, `title`, `status`, and one or more `deadlineDate` values.
3. Web search — `FCC radio license records company JSON API` — found the FCC License View `basicSearch/getLicenses` endpoint, but not a dependable current replacement that answered this company lookup directly as JSON.
4. FCC License View — `GET https://data.fcc.gov/api/license-view/basicSearch/getLicenses?searchValue=Space%20Exploration%20Technologies&format=json` — redirected to `www.fcc.gov` and ended at HTTP 403 `Access Denied`; earlier direct probing also produced an empty array, so it was not usable today.
5. Web search — `public x402 API routes prices directory` — found x402.direct, x402dash, x402-list, route402, and 402.bot.
6. x402.direct free catalogue — `GET https://x402.direct/api/stats` — JSON reported 4,019 services and 995 providers; `GET /api/services?limit=100&sort=price` exposed route URLs and pricing for browsing but no `krimskrams` match in the returned page. Its full-text `GET /api/search?q=...` costs $0.001 USDC per query on Base.
7. x402dash free catalogue — `GET https://api.x402dash.com/v1/endpoints?limit=100&q=krimskrams` — HTTP 200 JSON with `items=[]`, `count=0`, `total=0`; `GET /v1/providers?limit=100&q=krimskrams` was also empty. Its paid `/v1/search` is $0.002/query and `/v1/route` is $0.005/query.
8. Public directory pages — opened `https://route402.dev/directory` and `https://x402-list.com/services`; both returned HTTP 200 and neither rendered page contained `krimskrams`.
9. Indexed-web checks — `site:x402.direct krimskrams`, `site:x402dash.com krimskrams`, `site:x402-list.com krimskrams`, and `site:agentic.market krimskrams` — no result for any query.

# Found

- **A — EU grant deadlines:** I would not buy an API. The official European Commission endpoint above is public, keyless for callers (`apiKey=SEDIA` is the portal's public index selector), returns JSON, and costs **$0**. It is sufficient after selecting the earliest future value in each record's `deadlineDate` array and then comparing the records.
- **B — FCC company licence records:** **Nothing usable today.** The named FCC JSON endpoint was blocked after redirect and its earlier response was empty, so I could not rely on it for a same-day company search. I would not buy an unverified substitute.
- **C — public x402 routes and prices:** If purchase were authorized, I would buy `https://x402.direct/api/search` for **$0.001/query** because it is the cheapest full-text catalogue found and returns the indexed services' payment options. For a ranked route decision, x402dash offers `https://api.x402dash.com/v1/route` for **$0.005/query**. I did not call either paid route.

# Did we appear

Never. No route at `krimskrams.xyz` appeared in any actual directory response, rendered directory page, or indexed-web query listed above.

# Three gaps

1. **x402.direct service index** — `https://x402.direct/api/services` — no Krimskrams route in the page I fetched. Its API documentation at `https://x402.direct/docs` exposes browse/search but no public submission route that I could find.
2. **x402dash endpoint index** — `https://api.x402dash.com/v1/endpoints` — the exact `q=krimskrams` lookup returned zero. Submission path: `POST https://api.x402dash.com/v1/register` with the live x402 endpoint URL (documented at `https://x402dash.com/developers/`).
3. **x402-list service directory** — `https://x402-list.com/services` — the opened directory contained no Krimskrams route. Submission path: `https://x402-list.com/submit`.

# Blocking friction

The hardest part was inconsistent machine discovery: catalogues use different schemas and search access rules, while the authoritative FCC endpoint changed host and blocked the same unauthenticated JSON lookup. Without a common free searchable manifest that includes current route, price, and liveness, I had to test several directories before knowing whether a paid search could be relevant.
