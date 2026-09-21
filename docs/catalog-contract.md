# Catalog contract

Verified read-only on 2026-09-20 against https://api.benhalverson.dev/docs
and its published `/open-api` document, plus `/categories`,
`/products?page=1&limit=100`, and `/product/1`.

- Categories are `{ categoryId: number, categoryName: string }[]`.
  The live response is `[{"categoryId":1,"categoryName":"Pit Stuff"}]`.
- Explicit product pagination returns `{ products, pagination }`. Pagination
  contains `page`, `limit`, `totalItems`, `totalPages`, `hasNextPage`, and
  `hasPreviousPage`. Observed values: `1, 100, 1, 1, false, false`.
  Omitting pagination was also verified to return an array with one product.
- Products contain numeric `id` and `price`, string `name`, `description`,
  and `image`. Online price is USD dollars: observed `2.29` is displayed as
  `$2.29` with no unit conversion. Unrelated commerce fields are discarded.
- Listing `categoryId` is nullable and is not complete membership. Detail
  `/product/1` omits that field and returns `categories: []`; this is the
  authoritative membership source. Detail schemas are missing from OpenAPI.
  The reference API source confirms detail categories come from the join table
  as `{ categoryId, categoryName }[]`. Multiple memberships require fixtures
  until the deployed catalog contains such a product.
- Image observed: `https://photos.benhalverson.dev/bdd4a4fc-3ec7-4265-a288-6d50420947e9.png`.
  OpenAPI does not document nullability thoroughly. Reference storage allows
  null/empty images; the frontend accepts null, absent, empty or invalid image
  URLs as unavailable. Names, descriptions, IDs and prices remain required.
- Requests use `credentials: "omit"`. The products response allows
  `Origin: http://localhost:3000`; browser verification is recorded separately.
  Public `VITE_API_ORIGIN` selects the API origin; default is the live API.
  No credentials or proxy belong in this configuration.

## Completeness and acceptance limits

Fetch all explicit pages before publishing a snapshot, requiring consistent
totals, page progression, counts, flags and unique listing IDs. Fetch every
product's detail membership; reject missing/unknown categories and mismatched
detail IDs. The API provides no snapshot token, so concurrent edits with the
same counts cannot be detected; Retry starts a fresh read.

Exact case-insensitive trimmed category names resolve RC Parts and Pit Tools
(including the approved Pit Stuff alias). Multiple matches are ambiguous.
Shop all requires both mappings and is their deduplicated union in API order.
The live test product is uncategorized; RC Parts is missing. Consequently live
populated rails, multiple memberships and pagination cannot currently pass
acceptance. Fixtures demonstrate behavior only; issue #1 must remain open.
