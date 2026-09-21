# Lulu Speedworks storefront implementation specification

Status: historical consolidated specification, 2026-09-20. See [scope notes](README.md): issue #13 supersedes the Hono/Worker scaffold requirements with a frontend-only static build, Biome and Zod 3. The broader integration gates below remain future work.

This is the canonical implementation brief. It supersedes unresolved interview wording in `design-decisions.md`. The selected design is **B — Pit Bench**. The prototype is a visual reference, not production code or a live agent implementation.

## 1. Outcome and scope

Build an on-demand physical RC product store at **luluspeedworks.com**, using the supplied Lulu Speedworks logo and Pit Bench visual direction. A2UI is the primary interface throughout browsing, product configuration, cart, and checkout. Natural-language requests and direct controls act on the same shopping state. There is no separate “help me choose” assistant.

The existing 3D printer API owns catalog, pricing, accounts, carts, payment, orders, and fulfillment. The new storefront belongs in a separate repository from `store` and `3dprinter-web-api`. This document does not authorize changes to either reference repository, production deployment, or paid transactions.

### Launch catalog

| Category | Product type | User-provided compatibility |
| --- | --- | --- |
| Pit Tools | Tool holders | Pit organization; no vehicle-specific fit supplied |
| Pit Tools | Pit stands | Pit use; no vehicle-specific fit supplied |
| RC Parts | 1/10 motor fan mount | User says any 1/10 motor |
| RC Parts | 1/8 fan mount | Mugen MBX8 |
| RC Parts | Fan shroud | Team Associated B6.4 or B7 |

These describe the initial assortment, not five guaranteed production SKUs. Use actual published API product IDs, copy, images, prices, and category membership. Retain supplied fit descriptions without expanding them into tested dimensional guarantees. Do not invent compatibility for other vehicles. Product material is fixed; customers choose an available color and quantity. Material/filament identifiers remain internal commerce data.

Excluded: customer model uploads, digital downloads, paint masks, branded gear including stickers, material selection, admin/catalog authoring, in-person sales UI, general RC advice, and persistent conversation history. Branded gear is deferred until after launch. Do not add unrelated account features or a new fulfillment/payment system.

## 2. Confirmed experience

| ID | Requirement |
| --- | --- |
| UX-01 | Pit Bench desktop layout: compact product rail, focused product and fit information, visible configuration panel, integrated shopping composer. Preserve the dark treatment and Lulu identity selected in B. |
| UX-02 | On mobile, retain a readable product rail, detail, configuration, and composer without horizontal page overflow. Reflow regions; avoid hiding essential purchase controls behind the composer. |
| UX-03 | The agent can compose approved storefront components. It is not limited to choosing entire predefined page templates. Pit Bench supplies the visual and regional structure. |
| UX-04 | Clicking a product, choosing a color, changing quantity, opening/removing cart items, and proceeding through forms bypass model inference. API results update the same A2UI model/surfaces. |
| UX-05 | Guest browsing, guest natural-language requests, and guest cart additions are allowed. An account login is required before checkout/purchase; no guest checkout. |
| UX-06 | Preserve same-browser cart persistence across visits and synchronize tabs. A fresh conversation must not empty the cart. |
| UX-07 | Each visit starts a fresh conversation. Proposed session definition: a page reload/new tab starts a new conversation; SPA navigation retains that visit's context. No past conversation replay. |
| UX-08 | Products have permanent URLs that render directly without a prior conversation or model call. Back/forward navigation restores product context without repeating mutations. |
| UX-09 | “Buy it” prepares checkout. Only an explicit customer confirmation control displaying the authoritative payable total can proceed to payment confirmation. |
| UX-10 | Model failure, timeout, invalid output, rate limiting, and budget exhaustion leave deterministic A2UI browsing, cart, and checkout available. Typed requests display a concise unavailable/retry state. |
| UX-11 | Store answers use catalog, approved policy content, and the authenticated customer's orders. Unknown fit/policy facts are stated as unknown. |
| UX-12 | Standard controls have accessible names, keyboard navigation, visible focus, non-color-only selection indicators, announced status, and appropriate dialog focus. |

Suggested routes, as implementation defaults: `/` (Pit Bench), `/products/:productId`, `/cart`, `/signin`, `/signup`, `/checkout`, `/orders`, `/orders/:orderId`. URLs host A2UI surfaces; they do not imply a second conventional storefront. Product IDs are authoritative numeric API IDs; optional display slugs must not replace identity. Validate any sign-in return destination as a local allowed route.

## 3. Evidence and source precedence

Primary API reference supplied by the user: [published API docs](https://api.benhalverson.dev/docs). That Scalar page loads [OpenAPI JSON](https://api.benhalverson.dev/open-api). Retrieved 2026-09-20; document title `Heyo`, version `1.0.0`, description `Development documentation`. Its version label alone does not identify a deployed code revision. Snapshot SHA-256: `2436834165d89ba0204d3154c8769ef3e4368be3f7c7485f85c4654fb27c3f14`.

Published documentation is the contract baseline. Local code fills documentation gaps, with those additions marked **L** below. It is not proof of deployed behavior. No live cart, account, shipping-estimate, payment, or order mutation was performed for this spec.

- API checkout inspected: `3dprinter-web-api`, branch `feat/177-square-catalog`, HEAD `a87ca94f62747366930a96270ad7918147435121`. Existing uncommitted documentation was left intact.
- Store reference HEAD: `3e7709c6ef40517b470a01e9f682f193c7eed2f8`.
- Selected prototype: `luluspeedworks-prototype`, branch `prototype/initial-design`, selection commit `ab6a17c`; initial comparison commit `c3ab12e`.
- Local adjacent `docs/square-api-spec.md` describes a future payment replacement. The published API still describes Stripe, as does the inspected checkout implementation. Do not require Square or invent Square routes for this UI. Revalidate payment contracts if the backend changes before integration.

## 4. Commerce API mapping

Base URL: `https://api.benhalverson.dev`. **P** means published OpenAPI evidence; **L** means a local-code supplement requiring integration verification. Auth uses existing API sessions, not a new identity database. OpenAPI declares `cookieAuth` with cookie name `better-auth.session_token`; deployed secure cookie naming/attributes must be checked during integration.

| Capability | Existing route | Contract and handling |
| --- | --- | --- |
| Browse | `GET /products` | **P:** `{products, pagination}`. **L:** `page`, `limit`, capped at 100. Published items include numeric `id`, `name`, `description`, `image`, `imageGallery`, `price`, `filamentType`, `skuNumber`, `color`. |
| Search | `GET /products/search` | **P:** paginated name/description search. **L:** `q` requires at least two trimmed characters; `page`, `limit`. Do not assume semantic/fit/category search exists. |
| Detail | `GET /product/{id}` | **P:** path exists; response schema absent. **L:** numeric ID, single product, parsed image gallery and category list; 404 if missing. |
| Categories | `GET /categories` | **P:** category listing. Map actual category IDs. **L:** no category-filter query was found on product listing; fetch all necessary pages before local filtering for this small launch catalog. |
| Available colors | `GET /v2/colors?profile={fixedMaterial}&available=true` | **P:** `{success,message,data,count,lastUpdated?}`; each filament has `publicId,name,provider,profile,color,hexValue,public,available`. Filter by the product's fixed material. Select by `publicId`, not color label alone. |
| Create cart | `POST /cart/create` | **P:** 201 `{cartId,message}`. **L:** generates UUID only; cart rows first persist on add. Reuse the stored ID. |
| Read cart | `GET /cart/{cartId}` | **L:** `{items,total}`; each line has numeric `id`, `productId` containing SKU (not numeric product ID), quantity, color, filamentType, filamentId, name, price, and legacy Stripe data. Resolve SKU explicitly; do not conflate identifiers. |
| Add line | `POST /cart/add` | **P:** success message. Missing published body. **L:** `{cartId,skuNumber,quantity,color,filamentType,filamentId}`; UUID cart/filament IDs, integer quantity 1–69. Adds to an existing identical SKU/color/material/filament line. Refetch cart after success. |
| Set quantity | `PUT /cart/update` | **P:** success/error responses. **L:** `{cartId,itemId,quantity}`, zero removes; local schema only enforces nonnegative number. Storefront enforces integer 0–69 and treats this as absolute quantity, not increment. |
| Remove line | `DELETE /cart/remove` | **P:** route exists. **L:** JSON `{cartId,itemId}`. Refetch cart after success. |
| Sign in/up/out | `POST /auth/signin`, `/auth/signup`, `/auth/signout` | **P:** existing endpoints and sign-in user response. **L:** sign-in email/password; signup email/password with optional name. Verify validators and preserve session cookies. Prefer POST signout. |
| Profile/address | `GET /profile`, `POST /profile` | **P:** authenticated profile endpoints; schemas incomplete. **L:** update firstName,lastName,shippingAddress,city,state,zipCode,phone,country; derive identity from session. Never use an arbitrary customer ID supplied by the model. |
| Shipping | `GET /cart/shipping` | **P:** documented as `{address}`. **L:** requires authenticated session plus `cartId` query and actually returns `{shippingCost}` after a Slant estimate using the saved profile. **Contract discrepancy: G-02.** |
| Hosted checkout | `POST /cart/{cartId}/checkout` | **P:** body requires `successUrl,cancelUrl`; optional customerEmail and shippingAddress `{firstName,lastName,address,city,state,postalCode,country}`. Returns `{url,id}`; 409 includes per-line readiness reasons. Existing implementation requires login. |
| Embedded payment | `POST /cart/{cartId}/payment-intent` | **P:** optional customerEmail/shippingAddress, returns `{clientSecret,amount,currency}`; 409 readiness errors. This is the candidate for keeping checkout inside the A2UI surface. **Total/confirmation contract must pass G-02.** |
| Customer orders | `GET /orders`, `GET /orders/{id}` | **P:** authenticated customer order endpoints. **L:** list `limit,offset,direction`, response `{orders,pagination}`; detail verifies ownership. Expose customer-facing status, not raw fulfillment/admin internals. |

Do not expose upload, slicing, catalog mutation, admin recovery, refund, or webhook endpoints to the agent. `/success` is a callback route, not evidence of payment: the local handler returns static success JSON. Verified backend payment/order status is required before displaying a paid order.

### Normalization and persistence

- Generate or infer API DTO types from published schemas where complete; define explicit validated DTOs for documented gaps from verified handlers. Avoid untyped commerce payloads.
- Preserve numeric product ID, SKU, numeric cart-line ID, cart UUID, and filament UUID as distinct types. Use numeric product IDs for URLs, SKU for cart add, line ID for update/remove.
- The local `price` is a major-unit amount converted to cents for payment; confirm deployed units before arithmetic. Normalize money to integer minor units plus currency inside the storefront. Ignore in-person prices for online shopping.
- Select available filaments matching fixed material. Never silently substitute black/default filament when a user's requested selection cannot be resolved. API color cache can be seven days old in local code; handle readiness rejection without promising stock.
- Store cart ID and a display cache in browser storage. Rehydrate from API before authoritative totals or checkout. Cross-tab updates trigger reconciliation. Do not migrate storage from another domain implicitly; browser storage is origin-scoped.
- Add requests increment quantities and have no documented idempotency key. Disable duplicate submissions, serialize cart writes, and do not automatically retry an ambiguous add. Refetch and show the resolved state before asking the customer to retry. A timeout must not become a second add.
- Existing ownership enforcement varies by route; do not describe it as fully verified. The API must enforce authorization. Frontend filtering cannot secure public endpoints. Guest-to-login cart handoff and cross-user isolation are G-03 release gates.

## 5. Architecture and responsibilities

Confirmed stack: latest stable React/React DOM at production scaffold time, TypeScript, Vite, Hono, Cloudflare Workers, pnpm, shadcn controls, A2UI, AG-UI, Workers AI. Use the [Cloudflare React starter](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/); its [template source](https://github.com/cloudflare/templates/tree/main/vite-react-template) includes Hono. Commit exact dependency resolutions. Prototype versions are evidence, not a requirement to skip a fresh stable-version check.

Implementation default: React serves a trusted component registry; a Hono storefront Worker validates requests, coordinates the agent, and adapts the existing commerce API. The API remains the only commerce database. Operational budget/deduplication state belongs to the storefront Worker, not the commerce catalog. No vector database or secondary model provider is required for this launch catalog.

| Boundary | Owns | Must not own |
| --- | --- | --- |
| React renderer | Pit Bench layout, approved shadcn-backed A2UI components, form drafts, accessibility, URL navigation | Trusted prices, payment authority, AI secrets |
| Storefront Worker | Validated actions, agent tool execution, AG-UI stream, A2UI validation, throttling and inference accounting | Replacement catalog, order/fulfillment logic |
| Existing API | Catalog, selected filament validity, cart persistence, auth, quote/payment/order authority | Agent layout decisions |
| Workers AI | Store-focused intent interpretation and composition proposals | Arbitrary network calls, authorization decisions, charging customers |

A same-origin storefront API facade is the preferred integration default. It must preserve existing auth semantics and cookies rather than copying or manufacturing sessions. `luluspeedworks.com` is cross-site to the current API host; local API CORS/trusted-origin lists do not include it. Verify the complete proxy/cookie/origin design in real browsers before choosing cookie forwarding rules. G-03 covers this; a proxy is not assumed to solve authentication by itself.

## 6. A2UI and AG-UI contract

The prototype proved a custom catalog with `@a2ui/react` 0.11.1 and `@a2ui/web_core` 0.11.0 using v0.9.1 messages. Its React context and scripted parser do not prove live model generation, transport, or API integration. Pin one supported wire version on both ends after the protocol spike; do not mix newer documentation examples into the pinned parser.

[A2UI](https://a2ui.org/specification/v0.9-a2ui/) describes UI surfaces, components, bound data, and actions. [AG-UI](https://docs.ag-ui.com/quickstart/clients) transports agent events; its linked tutorial's example model/framework is not a required dependency for Lulu. The exact A2UI-over-AG-UI binding is G-04. Use an existing supported binding if compatible; otherwise document a versioned application payload carried in AG-UI's extension event mechanism, with explicit tests. Do not call an application extension a standard binding.

### Approved component families

| Family | Required capabilities |
| --- | --- |
| PitBenchLayout, Navigation, ProductRail | Stable orientation, categories, selected product, pagination, deep links |
| ProductDetails, ProductMedia, Compatibility | API-sourced identity/copy/images and verified fit text |
| ColorPicker, QuantityControl, AddToCart | Fixed-material colors, integer quantities, pending/error/success state |
| ShoppingComposer, StoreResponse, StatusNotice | Natural-language entry, concise grounded answers, retry/unavailable feedback |
| Cart, CartLine, MoneySummary | Confirmed lines and totals, deterministic update/remove/navigation |
| AccountForm, AddressForm | Existing auth/profile integration; sensitive values excluded from model state |
| CheckoutReview, PaymentControl | Trusted quote and customer confirmation; provider payment fields contained in an approved component |
| OrderList, OrderStatus | Authenticated API-owned status with pending/failure distinctions |

The agent may select/arrange approved components within Pit Bench regions and bind them to sanctioned data paths. It cannot emit executable React/HTML, arbitrary styles, unknown component types, external tool URLs, or a fabricated payment total. Commerce values are populated from server-validated API data. Fixed critical controls, such as final payment confirmation, have trusted implementations and cannot be redefined by generated text.

### Shared state and action semantics

Authoritative state carries a monotonically increasing session revision and separate domains: catalog results/selection, selected filament/quantity, confirmed cart, signed-in status, checkout phase/quote reference, customer order status, and agent availability. Form drafts are distinct from confirmed state. Keep credentials, cookies, full payment data, and unnecessary address data outside model inputs and AG-UI text events.

Logical action names below define the storefront adapter contract, not new commerce API endpoints:

| Action | Input | Effect |
| --- | --- | --- |
| browse/search/openProduct | category ID, search text, or product ID | Read API, compose/update surface; no mutation |
| selectColor/setQuantity | validated filament ID or quantity | Update selection; no model call for clicks |
| addItem/updateLine/removeLine | explicit selected item or line ID and quantity | Server validates against API data; mutate then reconcile |
| prepareCheckout | current cart reference | Require login, collect/update address, obtain trusted quote; no charge |
| confirmPurchase | trusted review reference plus explicit UI action | Revalidate totals/state and invoke payment integration; unavailable as a model tool |
| getMyOrders/getMyOrder | authenticated context and optional order ID | API verifies identity/ownership |

Natural-language mutations such as “add two” may use the same validated mutation handlers. Ambiguous product or color references require clarification within the primary surface; do not silently choose a purchasable item. A natural-language checkout request cannot synthesize `confirmPurchase`.

Every agent run carries session/run identifiers and a starting state revision. Serialize conflicting mutations; ignore or cancel stale visual results after newer customer actions. Disconnect/reconnect must not replay cart/payment mutations. Reconstruct the latest valid surface and confirmed state after a failed run. Stream lifecycle and validated data/UI updates through AG-UI; retain the last valid UI until a replacement validates. Reject unknown components, invalid references, disallowed bindings, oversized output, and unsupported actions before rendering/execution. Bound retries; malformed output must never execute a tool.

Initial model evaluation target is `@cf/zai-org/glm-5.3-flash` through Workers AI. [Cloudflare documents](https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/) tool and streaming parameters; that is not evidence of reliable storefront schema adherence. Run the acceptance corpus in section 9 before enabling live inference. No automatic switch to a second paid provider.

## 7. Checkout state machine

`cart → loginRequired (if signed out) → address → quoting → review → confirming → pendingPayment → paid | failed | cancelled | unknown`.

- Preserve the cart and return destination through sign-in. Expired sessions return to sign-in without implying payment failure or cart loss.
- Address, cart lines, prices, color, shipping, currency, or quote validity changes invalidate the review. Requote and require a new confirmation.
- The review shows items, quantities, colors, shipping, applicable API-provided charges, and payable total. Do not invent tax, free shipping, delivery dates, or return policy.
- The payment provider's embedded fields may live inside a trusted A2UI component. Creating an intent/session is not confirmation of payment. Keep payment credentials out of the model and application logs.
- Double-click, timeout, reload, and ambiguous provider outcome must not charge twice. Use the API/provider's durable payment correlation and idempotency. If the existing API cannot supply this, document a backend dependency; do not implement a client-only guarantee.
- Success requires authoritative payment/order evidence. Preserve distinct states for paid-but-fulfillment-pending, fulfillment failure, and completed shipping. Do not call an order failed solely because fulfillment has not completed.
- Current hosted checkout returns only a URL/ID, and local embedded intent code appears to calculate item subtotal separately from the shipping estimator. Neither proves an authoritative item-plus-shipping reviewed total. G-02 must be resolved before real checkout can ship. This does not block catalog/cart implementation.

## 8. Inference availability and budget

Confirmed monthly inference allowance: **$20**, separate from the Workers subscription. Owner email alerts at **$10/$15/$20** (50/75/100%), once per threshold per month. At 100%, suspend new model requests. Deterministic A2UI commerce remains available. This is an application spending control, not a provider-guaranteed billing cap.

Implementation defaults to validate: UTC calendar month; one atomic account-wide budget ledger; per-visitor request limiter; bounded input/output tokens, tool iterations, and retries. Numerical rate limits and token ceilings are configuration selected from G-04 evaluation, not additional product-interview questions.

- Before each paid model invocation, atomically reserve a conservative maximum cost; include parallel/in-flight calls and all retry/tool-loop model calls. If insufficient unreserved budget remains, decline inference early and use fallback.
- Reconcile actual reported usage against the reservation using a versioned model-price table. Unknown usage after a timeout retains a conservative reservation until reconciliation; do not treat it as free. Reservations are admission control; threshold alerts use tracked charged/estimated spend with uncertainty disclosed.
- If multiple thresholds are crossed together, record each crossed threshold and send one clearly itemized notification or deduplicated individual emails. Retry delivery durably without reopening inference or spamming alerts.
- Month rollover starts a new ledger/alert namespace. In-flight usage stays assigned to its invocation month. Keep the prior month's unresolved usage for reconciliation.
- If the budget service is unavailable, fail closed for new inference and leave commerce controls functioning. Alert transport failure must not reset the spend counter.
- Required deployment configuration: recipient email, verified sender/provider, budget currency and limit, model ID, price table, limiter thresholds, and observability access. Email service choice remains an implementation dependency; no owner emails are sent during specification work.
- Record request/run IDs, model usage/cost, latency, fallback reason, validation failures, and mutation correlation without raw credentials/payment data. Routine logs should not retain full conversations or private profile fields.

## 9. Acceptance criteria

| ID | Scenario and pass condition |
| --- | --- |
| AC-01 | Open the store without inference: real paginated catalog renders in Pit Bench, with empty/loading/API-error states and working category navigation. |
| AC-02 | Open/reload/share a product URL: correct product, fixed material, available colors, and API price appear. Unknown ID yields a recoverable not-found surface. |
| AC-03 | Change color/quantity and add by click: zero model calls, correct SKU/filament IDs, one acknowledged cart change, refreshed total. No material picker. |
| AC-04 | Type “show MBX8 mounts,” “make it red,” and “add two”: selection and cart reflect verified API data; an unavailable red selection or ambiguous reference does not substitute another item. |
| AC-05 | Ask about unsupported vehicle compatibility or non-store topics: concise grounded limitation; no invented fit, policy, product, or price. |
| AC-06 | Refresh and open a second tab: persisted cart reconciles, tab changes synchronize, and prior conversation is not replayed. Cart IDs/SKUs are not confused with numeric product IDs. |
| AC-07 | Signed-out checkout requires login and returns to the same cart. Expired sessions recover. Another user's orders/cart cannot be read or mutated through either action or model tool. |
| AC-08 | Shipping/profile/price changes invalidate review. Confirmed total equals API/provider charged total and recorded order total, including shipping and applicable charges. |
| AC-09 | “Buy it” never charges. Only explicit confirmation can proceed. Duplicate clicks, stream replay, and ambiguous failures do not create duplicate payments/orders. |
| AC-10 | Provider redirect alone cannot show paid. Pending confirmation and paid/fulfillment-failed states remain distinguishable and recoverable. |
| AC-11 | Model unavailable, malformed output, unknown component/action, timeout, and budget suspension: last valid or fallback A2UI remains usable through checkout. |
| AC-12 | A slow model response cannot overwrite a later click; reconnect restores state without replaying mutations. Tool inputs cannot override auth identity or authoritative price. |
| AC-13 | Concurrent model calls, retries, and missing usage respect budget reservations. Email alerts deduplicate at each threshold; 100% stops new inference; month rollover and failed delivery are covered. |
| AC-14 | Desktop and mobile keyboard/touch flows work, including dialogs, color labels, focus, scrolling, and error announcements. No prototype switcher, fixture prices, or simulated checkout ships. |
| AC-15 | Production origin login/cookies work in Chromium and Safari/WebKit; CSRF/origin checks pass; customer/private responses are not cached across users. |

Model evaluation corpus must include all five initial product types, typos, absent colors, ambiguous references, repeated adds, out-of-scope requests, fabricated product IDs, hostile catalog text, and payment-authorization attempts. Hard gates: zero unauthorized payment/action executions; all emitted UI accepted by validation or safely rejected; deterministic commerce remains usable in every injected inference-failure case. Record successful task completion, latency, token spend, repair rate, and cost per completed flow. Set experience thresholds from measured results before launch, without treating a single successful prompt as validation.

## 10. Integration gates and milestones

| Gate | Evidence still needed | Closure artifact |
| --- | --- | --- |
| G-01: API schema gaps | Deployed detail/auth/cart/profile DTOs, price units, search/category behavior; reconcile local supplements with published API | Versioned adapter contract and representative staging responses; no secrets |
| G-02: quote/payment | Resolve shipping docs mismatch; prove shipping-inclusive authoritative quote, expiry/invalidation, payment correlation, final confirmation, idempotency and order status | API contract/required backend issue plus staging payment acceptance evidence |
| G-03: identity/cart | Verify luluspeedworks.com origins/cookies, guest handoff, all cart ownership paths, order isolation, cross-tab behavior | Browser and API authorization matrix; scoped backend fixes if required |
| G-04: live agent | Select compatible renderer/wire/AG-UI binding; bounded Workers AI loop; evaluate schema adherence, usage reporting and latency | Pinned protocol contract, corpus results, limiter/token configuration |
| G-05: launch content/operations | Actual catalog assets/fit copy/policies, production repo identity, domain config, email recipient/sender and budget ledger deployment | Launch configuration checklist with owners and verified values |

All gates belong to the storefront implementation owner to investigate; API changes are separately scoped to the API repository. Only actual missing business inputs (such as owner recipient address or policy copy) require owner input. Do not reopen settled layout, account, color/material, or cart-persistence decisions.

| Milestone | Deliverable | Exit criteria |
| --- | --- | --- |
| M0 — contracts | Close G-01; specify fixes/dependencies for G-02/G-03; close protocol compatibility portion of G-04 | Concrete API DTOs and protocol binding; no invented payment endpoints |
| M1 — deterministic Pit Bench | Production scaffold in new repo; real catalog/detail/colors/cart and A2UI fallback | AC-01–03, AC-06 and relevant mobile checks; no inference needed |
| M2 — primary agent | Workers AI + AG-UI + approved A2UI catalog, bounded tools and state ordering | AC-04–05, AC-11–12; G-04 measured; budget admission active before paid traffic |
| M3 — accounts and purchase | Existing login/profile, authoritative review, payment, customer order surfaces | G-02/G-03 closed; AC-07–10 and AC-15 |
| M4 — release | Operational alerts/budget, content, deployment and full regression evidence | G-05 and AC-13–14 plus complete end-to-end acceptance; no unresolved checkout/auth gate |

## 11. Supporting artifacts

- [Decision history](design-decisions.md), [project glossary](CONTEXT.md), [primary-interface ADR](docs/adr/0001-primary-a2ui-storefront.md), [stack ADR](docs/adr/0002-react-hono-cloudflare.md).
- [Reference provenance](README.md) and [interface comparison/B selection](interface-designs.md). The original throwaway prototype branch remains the design primary source; its runtime is not part of this repository.
- Local implementation supplements: `3dprinter-web-api/src/routes/{product,printer,shoppingCart,auth,users,orders,payments}.ts`, `src/db/schema.ts`, `src/utils/authMiddleware.ts`, `lib/auth.ts`, and `src/index.ts`; `store/src/context/CartContext.tsx` and protected-route/sign-in code.

This spec is complete as a consolidated requirements and implementation brief. It intentionally does not claim unresolved deployed contracts, model quality, or payment correctness have been verified. Close the listed integration gates with evidence before releasing their dependent features.
