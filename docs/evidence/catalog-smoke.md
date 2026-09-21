# Issue #1 verification

## TanStack Query revision — 2026-09-20

`pnpm check` passed on the revision replacing the manual loader with TanStack
Query 5.103.1: 35 tests, 100% statements/branches/functions/lines globally and per
runtime file, lint, typecheck and production build. The real renderer tests
cover concurrent and out-of-order pagination/details, caching and origin
isolation, manual retry, cancellation and obsolete completions.

Production assets were served from the isolated query worktree with
`pnpm exec vite preview --host ::1` on port 3000. The live API success-path
smoke initially could not complete; `getent hosts api.benhalverson.dev` failed
and curl reported `Could not resolve host`. A subsequent Chromium run recovered
and passed at 1440×1000, 850×900, 390×844 and 320×740: hashed production assets,
categories/list/detail HTTP 200, CORS, logo loading, visible category controls,
Tab/Enter/Space navigation, visible focus, disabled empty-result pagination,
no horizontal overflow, no console/page errors and no failed requests.
No API interception or fixtures were used in the browser.

The live catalog still lacks RC Parts and categorized products. Populated
imagery, multiple memberships, pagination and prices therefore remain fixture
coverage only. Shop all/RC Parts report unavailable and Pit Tools reports no
products. Issue #1 stays open.

## Production assets against the deployed API

2026-09-20: built with `pnpm check` and served using `pnpm exec vite preview
--host ::1` on port 3000. An existing IPv4 Vite development server was left
running. Chromium used `--host-resolver-rules=MAP localhost [::1]` so the page
origin remained the API-approved `http://localhost:3000`. No API interception,
proxy, fixture responses, or deployment was used.

| Check | 1440×1000 | 850×900 | 390×844 | 320×740 |
| --- | --- | --- | --- | --- |
| Loaded hashed production JS/CSS | Pass | Pass | Pass | Pass |
| Categories, explicit products page, detail response | 200 | 200 | 200 | 200 |
| Document width equals viewport | Pass | Pass | Pass | Pass |
| Brand image loaded | Pass | Pass | Pass | Pass |
| Category controls visible | Pass | Pass | Pass | Pass |
| Tab/Enter skip link and category activation | Pass | Pass | Pass | Pass |
| Space activates Pit Tools; visible focus outline | Pass | Pass | Pass | Pass |
| Previous/Next disabled for empty Pit Tools | Pass | Pass | Pass | Pass |
| Console/page errors and failed requests | 0 | 0 | 0 | 0 |

Shop all and RC Parts explicitly reported unavailable. Pit Tools reported
“No products in Pit Tools.” Live data contains one uncategorized test product
and only Pit Stuff, so no product imagery or populated pagination can be
accepted live. Product imagery, multi-page results, multi-membership and money
display are covered with test fixtures only. Issue #1 remains open.

The initial exploratory browser request encountered a transient network error
and correctly showed Catalog unavailable with Retry. A subsequent run and the
four-size acceptance smoke above completed without errors. The network is not
assumed reliable.

## Automated verification

`pnpm check` passed: lint, TypeScript, 50 tests, 100% statements/branches/
functions/lines globally and in every runtime file, and production build.
Tests exercise the actual A2UI renderer, dynamic child bindings, native buttons,
manual retries, timeout/abort, late completions, processor reuse and Strict Mode
cleanup. API tests reject changed totals, page/flag inconsistencies, repeated
IDs, malformed JSON and invalid membership. No live network is used in CI.
