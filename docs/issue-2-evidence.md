# Issue 2: product links and configuration

Scope: frontend only; no cart mutations, model calls, API edits or deployment. Shop all includes every returned product regardless of named category mappings. Add to bag remains disabled.

## API verification

On 2026-09-20 Pacific time, started the existing `3dprinter-web-api` checkout using `pnpm exec wrangler dev --local --ip 127.0.0.1 --port 8787`. No API source/configuration changes were made. Existing local D1 and KV bindings were used.

- `GET /docs`: HTTP 200, Scalar UI referencing `/open-api`.
- `GET /open-api`: OpenAPI 3.1.0. Product detail operation is documented but its response schema is absent. Color response documentation defines `publicId`, `name`, `profile`, `available`, `color`, and other metadata. `public` is documented as required but absent in actual successful responses, so the adapter does not require that unused field.
- `GET /products?page=1&limit=2`: HTTP 200, four total products in the local database.
- `GET /product/2`: HTTP 200, numeric ID `2`, SKU `GEAR-1245589033-AEGK`, name `gear diff holder`, price `8.58`, fixed material `PETG`, image `image.png`, empty gallery, category `Pit Area`. Relative image is handled as unavailable under the existing safe-image policy.
- `GET /product/1`: HTTP 404 with `Product not found`.
- `GET /v2/colors?profile=PLA&available=true`: HTTP 200, 13 options, UUID identities, all PLA and available.
- `GET /v2/colors?profile=PETG&available=true`: initial unsuccessful response followed by HTTP 200 with four available PETG UUID options. The UI exposes retry for this failure mode.

These are real responses from a locally running API and its existing state/upstream integration, not test fixtures.

The first deployed requests failed through the web tool and shell DNS/connection setup. A later retry using `curl --noproxy '*'` succeeded, completing representative deployed verification:

- `https://api.benhalverson.dev/docs`: HTTP 200; `/open-api`: OpenAPI 3.1.0 with the same missing product-response schema and unused `public` discrepancy.
- `/products?page=1&limit=2`: one product, numeric ID 1, SKU `TEST-3398813686-9BLO`, price 2.29, material PLA.
- `/product/1`: name `Test`, description `test`, price 2.29, fixed PLA, absolute primary image and two gallery URLs, empty categories. This also verifies the real uncategorized Shop all case.
- `/product/9007199254740991`: HTTP 404, `Product not found`.
- `/v2/colors?profile=PLA&available=true`: success, 37 UUID options, every option PLA and available.
- `/v2/colors?profile=PETG&available=true`: success, five available PETG UUID options.

Local and deployed catalogs/color counts differ, so neither was used as a hardcoded application fixture.

The local detail route returns the product object directly. `id`, `skuNumber`, and filament `publicId` have separate purposes. USD display and price units follow the existing catalog contract; the observed detail price matches the catalog price. Compatibility is rendered only when supplied as text; description is displayed verbatim as safe React text. No compatibility is inferred from a product name.

## Validation and review

- Pinned Node `24.18.0`, pnpm `10.23.0`. Final runtime `pnpm check` passed: Biome, TypeScript, 66 tests, V8 100% statements/branches/functions/lines globally and in every runtime file, and production Vite build. No coverage exclusions or thresholds were relaxed.
- Tests exercise actual A2UI bindings/actions and Strict Mode, independent detail loading, numeric IDs versus SKUs, malformed/404/network/timeout states, cancellation and late detail/color responses, history restoration/reload reset, duplicate labels with different UUIDs, material/availability rejection, unavailable-color invalidation and non-resurrection, empty/retry states, quantity boundaries, safe text, missing/broken images, and missing/ambiguous Shop all mappings.
- Production asset smoke tests using Playwright Chromium passed at 1440, 390 and 320 pixels, first against the local API and then the deployed API. Verified `/products/:id` reload, back restoration, reset on reload, native Ctrl-click new tab, logo decode, keyboard skip-link/main focus, disabled Add to bag, and no horizontal overflow.
- Local API smoke: no page errors or console errors at all three sizes. Deployed API smoke: no JavaScript page errors; one transient DNS console resource error in the initial desktop run, none in mobile runs or focused desktop recheck. The focused run confirmed Ctrl-click new-tab behavior and recorded external image ORB failures. These render the intended fallback; successful real gallery-image display is not claimed.
- Logged confirmed external gallery content-type/browser-blocking issue: [#16](https://github.com/benhalverson/luluspeedworks/issues/16). Primary image also failed in Chromium despite its advertised image/png content type; its cause remains unverified and is described as such in the issue. No API/asset changes were made.
- Two review rounds used; see [separate reports and dispositions](issue-2-reviews.md). The confirmed P2 was repaired and independently re-reviewed. No unresolved implementation P0–P2 findings remain. The P3 asset issue remains open.

Work is on branch `feat/2-product-configuration` in the main `/home/ben/projects/luluspeedworks` checkout, following the user's instruction to use branches only. Implementation checkpoints: `2cb9fdd`, `82691ab`, `da1304b`; includes Shop all commit `d7faf6c`. No deployment or cart mutation occurred.
