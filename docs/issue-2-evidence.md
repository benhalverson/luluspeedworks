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

These are real responses from a locally running API and its existing state/upstream integration, not test fixtures. They do not establish deployed API parity. Attempts to access `https://api.benhalverson.dev/docs` and representative deployed endpoints failed through the web tool and shell DNS/connection setup. Deployed verification remains outstanding.

The local detail route returns the product object directly. `id`, `skuNumber`, and filament `publicId` have separate purposes. USD display and price units follow the existing catalog contract; the observed detail price matches the catalog price. Compatibility is rendered only when supplied as text; description is displayed verbatim as safe React text. No compatibility is inferred from a product name.

## Validation and review

Implementation and verification are in progress. Review rounds and final acceptance results will be recorded here before delivery.
