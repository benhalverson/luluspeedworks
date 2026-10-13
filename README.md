# Lulu Speedworks

Frontend-only React storefront for physical RC parts and pit tools. The selected **B — Pit Bench** storefront uses the real A2UI renderer with catalog browsing, product configuration, a persistent bag, account dialogs and password recovery. The private **Build Log** workspace provides administrator-authorized product conversations, draft editing and attachment controls.

These are frontend capabilities. Admin conversation preparation supports bounded interpretation through the companion API, targeted A2UI questions, direct corrections and explicit category creation after exact-name confirmation. The workspace does not provide catalog publication, full product CRUD or checkout. Backend integration and production readiness require separate verification.

## Clean-clone setup

```sh
git clone https://github.com/benhalverson/luluspeedworks.git
cd luluspeedworks
nvm install
nvm use
corepack enable
corepack prepare pnpm@10.23.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

Use the Node and pnpm versions pinned in [package.json](package.json) and [.nvmrc](.nvmrc). The setup commands above are for a fresh human development environment; agents use the active shell executables as specified in [AGENTS.md](AGENTS.md). Development and `pnpm exec vite preview` use `http://localhost:3000` with strict ports. The API must allow that frontend origin.

For a separately running development API, create `.env.development.local` in the repository root:

```dotenv
VITE_API_ORIGIN=http://localhost:8788
```

Then run `pnpm dev`. Vite loads this Git-ignored file in development mode; an explicit shell `VITE_API_ORIGIN` takes precedence. Restart the development server after changing the file. The API must allow `http://localhost:3000`.

Production builds and preview use production mode and do not load `.env.development.local`. The public build-time `VITE_API_ORIGIN` continues to default to the storefront’s same-site API hostname, `https://api.luluspeedworks.com`, unless explicitly configured for the build. Changing the local API origin does not move production drafts or other data into the local API.

`VITE_API_ORIGIN` is public and must contain no secrets. Vite exposes variables prefixed with `VITE_` to the browser, so keep private variables outside that prefix. Public catalog reads omit credentials; auth, bag, profile and private draft requests include credentials. External presigned print uploads omit cookies. No proxy or backend is included. See the [source map](#source-map) for request contracts.

Changing the API origin selects a separate origin-scoped browser cart and private cache; existing pointers for the previous origin remain stored and are not silently transferred. Existing sessions on another API hostname are not assumed to transfer.

Lulu exposes password authentication; passkey controls appear only on the API’s existing `https://rc-store.benhalverson.dev` passkey origin. RC credentials are bound to that relying party; enabling Lulu passkeys requires a separate relying-party configuration. DNS, certificates and API hosting for the configured hostname must be provisioned separately.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the local frontend with Vite |
| `pnpm lint` | Non-mutating Biome lint and format checks |
| `pnpm format` | Apply Biome formatting |
| `pnpm typecheck` | Strict TypeScript checks |
| `pnpm test` | Run Vitest once |
| `pnpm test:links` | Check inline relative Markdown file links in root docs, `docs/` and `.github/` |
| `pnpm test:coverage` | Enforce 100% statements, branches, functions and lines per file and globally |
| `pnpm build` | Build static frontend assets into `dist/` |
| `pnpm check` | Run Biome, type checking, coverage and build |
| `pnpm test:smoke` | Build and test production assets with controlled API responses in Chromium and WebKit |

Runtime TypeScript/TSX coverage includes unimported application files, the entrypoint and local UI controls. Tests live outside `src`. GitHub Actions runs `pnpm check` (including local-link checks) and `pnpm test:smoke` for PRs and pushes to `main`, installing the frozen lockfile without production secrets.

## Production browser smoke checks

Install the pinned runner's browsers once, then run the command:

```sh
pnpm exec playwright install chromium webkit
pnpm test:smoke
```

On Linux CI, `pnpm exec playwright install --with-deps chromium webkit` also installs system dependencies. [CI](.github/workflows/check.yml) uses this setup.

The runner builds into ignored `dist-smoke/`, pins the test API origin to `https://api.lulu.test`, and serves production assets at `http://127.0.0.1:4173`. API responses are controlled in browser tests; unhandled external requests fail the run. The admin gallery fixture receives file bytes through a test-owned loopback HTTP server with an ephemeral port; storage/provider outcomes remain mocked. The preview refuses to reuse another server on its port. Playwright owns server startup and teardown; intentional shutdown is normal cleanup, while test/startup failures retain a failing exit status.

All scenarios run in four projects: Chromium `desktop` and `mobile`, and `webkit-desktop` and `webkit-mobile`. Each engine uses desktop (1440px) and mobile (390px, touch enabled) viewports. Cases cover account/bag dialogs, shared logo loading, keyboard focus, page overflow, unexpected console errors, detail/save denial, delayed saves and authorization retry. Inference, budget and accounting fallbacks each continue through deterministic product selection, bag updates and a fresh authoritative checkout review without another model request. These exercise the bundled React/A2UI/auth client with mocked API responses. They do not verify backend authorization enforcement, provider storage, native API cookies, actual Safari/iOS devices or live commerce. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, when set locally, overrides only the Chromium executable; WebKit uses the pinned runner's installation.

Logs are retained in `artifacts/smoke/server.log`; the HTML report is in `artifacts/smoke/report/`, and failing tests retain screenshots and traces in `artifacts/smoke/results/`. CI uploads `artifacts/smoke/` even when the job fails. All artifacts are ignored by Git. To focus on a scenario, use `pnpm test:smoke --project=webkit-mobile -g 'delayed save'`.

## Source map

| Area | Entry points and boundaries |
| --- | --- |
| Routes and storefront orchestration | [App.tsx](src/App.tsx): product URLs, account routes, bag state and storefront A2UI surface |
| Catalog and rendering | [queries.ts](src/storefront/queries.ts), [api.ts](src/storefront/api.ts), [catalog.tsx](src/storefront/catalog.tsx), [messages.ts](src/storefront/messages.ts), [controller.ts](src/storefront/controller.ts) |
| Product configuration | [product.ts](src/storefront/product.ts): numeric product IDs, SKU-backed bag requests and API color IDs |
| Accounts and private bag state | [auth.ts](src/storefront/auth.ts), [account.tsx](src/storefront/account.tsx), [cart.ts](src/storefront/cart.ts), [profile.tsx](src/storefront/profile.tsx), [passkey.tsx](src/storefront/passkey.tsx) |
| Password recovery | [recovery.tsx](src/storefront/recovery.tsx): standalone request/reset routes |
| Customer orders | [orders.tsx](src/storefront/orders.tsx): verified account history, permanent detail routes and separate payment/fulfillment evidence |
| Admin access and draft workflow | [workspace.tsx](src/admin/workspace.tsx): identity-scoped verification, separate draft caches, private callbacks and recovery |
| Draft requests and attachments | [request.ts](src/admin/request.ts), [attachments.ts](src/admin/attachments.ts), [contracts.ts](src/admin/contracts.ts): protected API denial versus external transfer failure |
| Conversation preparation | `POST /admin/product-drafts/:id/prepare` accepts revision-bound answers and an optional current message. Direct edits omit the message and bypass inference. Read/reload and completeness never execute operations. Exact category confirmation creates or reuses that category through the revision-checked API; the endpoint does not return a proposed online price. |
| Admin A2UI cards | [card.tsx](src/admin/card.tsx): renderer lifecycle and action bindings |
| Shared appearance | [brand-link.tsx](src/components/brand-link.tsx), [local controls](src/components/ui), [styles.css](src/styles.css): branding, shadcn controls, theme/base styles |
| Regression and browser tests | [test/](test), [smoke configuration](playwright.config.ts), [review standards](CODING_STANDARDS.md) |

## Rendering and design

`src/storefront/catalog.tsx` declares stable approved component implementations, including ProductEntry and CategoryControl. The root schema marks regional references with A2UI `componentId()`. Button and Input are minimal shadcn adaptations; `components.json` records the Tailwind/shadcn configuration.

Layout, typography, responsive variants and control overrides use Tailwind utilities. `src/styles.css` contains only shared theme tokens and base styles. Named `tablet`, `bench` and `wide` breakpoints preserve the selected design's region transitions.

`src/storefront/messages.ts` defines typed `createSurface`, `updateDataModel` and `updateComponents` messages. `controller.ts` owns the catalog snapshot, category and page, routing A2UI actions to data-model updates on one processor. Entries use a bound A2UI child template. `App` creates a controller in each effect setup and renders `A2uiSurface`. Cleanup aborts requests and disposes the surface group and action subscriptions; the renderer cleans up its node resolver. Strict Mode gets a fresh copy of initial messages. There is no bootstrap endpoint.

The adapter validates Zod DTOs and reads category membership directly from every paginated catalog item before publishing the complete snapshot. Catalog browsing requests categories and list pages without fetching individual product details or print previews; selecting a product still loads its configuration detail on demand. Server USD prices are never converted. Categories filter locally, ten products per UI page. Requests time out after ten seconds with manual Retry. Missing or ambiguous category mappings are unavailable; Shop all includes every product, including uncategorized items (Pit Stuff is an accepted alias for Pit Tools). Network fixtures exist only in tests.

Keep the pinned A2UI renderer/core, Zod and wire versions compatible. Dependency versions are recorded in [package.json](package.json) and [pnpm-lock.yaml](pnpm-lock.yaml); protocol messages use wire **v0.9.1**.

The supplied Lulu logo is embedded losslessly in `public/brand/lulu-logo.svg` as a self-contained PNG-backed SVG. Barlow and Barlow Condensed fonts are bundled through Fontsource. The combined [third-party licenses and notices](public/THIRD_PARTY_LICENSES.txt) ships with the built site at `/THIRD_PARTY_LICENSES.txt`.

## Account and bag handoff

Sign-in, signup, profile and POST signout use the existing Better Auth identity service. The validated local `returnTo` destination survives authentication and explicit bag-restoration retries. Signout and expiry hide private bag data while retaining account-scoped browser pointers; switching accounts and creating another bag preserves the previous account's pointer. Browser storage is an untrusted convenience, never an authorization source.

The API must persist cart ownership independently of lines. `POST /cart/create` receives `{ expectedUserId: string | null }` and returns `{ cartId, ownerId, guestToken? }`, with a guest capability only for anonymous carts. `POST /cart/:cartId/claim` requires credentials, `X-Cart-Token` and `{ expectedUserId: string }`, returning `{ message, ownerId }`. The expected user is a race-detection assertion checked against the authenticated session, never a client-selected owner. Claim retries are confined to the intended account. Reads and mutations include credentials and the guest capability while needed; successful claims stop sending that capability. The API must independently authorize every cart, shipping and payment-preparation request.

Pending writes retain a durable uncertainty marker and are never automatically retried. Account changes, route teardown and authorization denial invalidate their client continuations without cancelling a server mutation that may already have committed. Reads are disposed through the query signal. Recovery explicitly refreshes the bag before another edit.

Configure the API to allow the storefront in both trusted auth origins and credentialed CORS, and disable caching of private responses. Before release, verify cookie retention, expiration and cross-user isolation in Chromium and WebKit against a non-production API. Mocked browser tests establish UI behavior only; CORS alone does not ensure browser acceptance of a cross-site cookie.

## Password recovery

Choose **Forgot password?** in the password sign-in form, or open `/forgot-password` directly. The standalone recovery pages use Lulu’s branding and do not load the catalog. Both routes support direct visits and refreshes through the static host’s SPA fallback.

The email form uses the configured Better Auth client's `requestPasswordReset({ email, redirectTo })`. Its callback uses the current storefront origin and `/reset-password`, including a validated `returnTo` destination. Successful requests always show the same confirmation, regardless of whether an account exists. Token expiry is owned by the backend; requesting another email requires an explicit action.

The reset page accepts the emailed `token`, validates matching passwords of 8–128 characters without trimming, and calls `resetPassword({ token, newPassword })`. Missing, invalid, expired, or reused links offer a fresh email request. Requests do not retry automatically; network uncertainty does not imply that an email was not sent or a password was not changed.

After a successful reset, the page clears password fields, replaces the URL to remove the token, clears cached queries, and refreshes Better Auth’s session after backend session revocation. Saved bag data remains available to the existing sign-in/restoration flow. Users explicitly choose **Sign in**; resetting a password does not authenticate them. If session refresh fails, the page keeps the successful reset confirmation and explains that a reload is needed.

Credentials and reset tokens remain outside A2UI, browser storage, mutation variables, and onward navigation destinations. Automated SDK checks use mocked auth responses; production deployment and a live email/reset test with a controlled account are separate verification steps.

## Delivery workflow

Before implementing, identify the requested acceptance criteria and the UI/request boundaries being changed. For session, cache or mutation work, apply the [request-ordering review standards](CODING_STANDARDS.md#request-ordering). Run focused tests and typechecking during implementation; run `pnpm check` and `pnpm test:smoke` on the final change.

In the final handoff and [PR template](.github/pull_request_template.md), report each state separately. Use **passed**, **failed**, **blocked**, **not run** or **not applicable**, with evidence or a reason:

| State | Required evidence |
| --- | --- |
| Implementation | Which requested acceptance criteria are complete and which remain |
| Local checks | Commands, results and the tested revision/working diff |
| Controlled browser checks | Built assets, viewports/scenarios and mocked API boundary |
| GitHub CI | Result for the exact commit, or explicitly not checked/pending |
| API/provider integration | Actual environment and verified outcomes; mocked results do not qualify |
| Deployment | Deployed revision/environment and verification, or explicitly not deployed |

Partial evidence supports only that state. Saving a private draft does not prove catalog publication; an accepted reset request does not prove email receipt. Distinguish the frontend task's completion from broader A2UI milestones. Production deployment, domain changes and live commerce require separate authorization.

## Static hosting

[wrangler.jsonc](wrangler.jsonc) serves static `dist/` assets with SPA fallback. Product, account, recovery and admin routes resolve through [App.tsx](src/App.tsx); unknown routes fall back to the storefront. This repository has no custom Worker request handler.

After building, `pnpm exec wrangler dev --local` can preview the static hosting configuration, and `pnpm exec wrangler deploy --dry-run` validates packaging without publishing. Actual deployment and domain configuration are outside #13. No backend credentials or bindings are configured. Future endpoint work belongs on a dedicated branch in `3dprinter-web-api`; reuse its existing health endpoint.

### Launch configuration and operations

[Launch issue #12](https://github.com/benhalverson/luluspeedworks/issues/12) remains open until the approved content and integration gates have been verified. Passing the controlled browser matrix does not close those gates. Keep the release commit, CI run, target environment and actual outcomes in the release handoff, using the delivery states above.

| Area and owner | Required value or acceptance before release |
| --- | --- |
| Store owner: launch content | Approve published product IDs, photos, prices, fit descriptions and store policy copy. The historical assortment is not a list of guaranteed SKUs. Preserve unknown fit/policy facts; exclude customer uploads, material selection, masks and branded gear from customer shopping. |
| Release operator: static host | Confirm the Cloudflare account, Worker `luluspeedworks`, target domain/certificate, deployment mechanism and previous working version. The checked-in config serves `dist/` with SPA fallback; it does not declare a custom domain or a staging environment. This repository's Check workflow validates changes and does not deploy them. |
| Release operator: API destination | Record the build-time public `VITE_API_ORIGIN` (default `https://api.luluspeedworks.com`) and matching API revision. Select a non-production API for integration; an arbitrary preview hostname does not establish isolated provider/storage resources. |
| API owner: identity | Verify trusted origins, credentialed CORS, cookie retention/expiry, reset-email receipt, guest bag claim and cross-user isolation in Chromium/WebKit against the selected API. Link [#4](https://github.com/benhalverson/luluspeedworks/issues/4) acceptance, including private-response cache behavior. |
| API owner: checkout and agent | Link actual quote/charge/order-total and durable payment-correlation acceptance for [#6](https://github.com/benhalverson/luluspeedworks/issues/6), and measured agent validation for [#8](https://github.com/benhalverson/luluspeedworks/issues/8) / [#11](https://github.com/benhalverson/luluspeedworks/issues/11). Provider redirects alone never establish payment. |
| Store/API owners: inference operations | Select verified sender/owner-recipient addresses and verify receipt plus durable retry for [#10](https://github.com/benhalverson/luluspeedworks/issues/10) / [API #193](https://github.com/benhalverson/3dprinter-farm/issues/193). Record the deployed ledger, $20 USD UTC-month allowance, model/price version, limits and observability access. Keep inference disabled until these gates pass. |

Approved launch content/policies, the integration environment and email addresses remain owner inputs. Live email, payment, agent and deployed hosting outcomes require their own evidence; no values or successful outcomes are inferred from fixtures. Production deployment, domain changes and real paid transactions require separate authorization.

Before an authorized rollout, run `pnpm check`, the complete `pnpm test:smoke` matrix and `pnpm exec wrangler deploy --dry-run`. Confirm the chosen account and target before any remote command. Inspect `pnpm exec wrangler deployments list --name luluspeedworks` and `pnpm exec wrangler versions view VERSION_ID --name luluspeedworks` to identify and record the previous working version, its source commit and API compatibility. Replace `VERSION_ID` with the inspected version ID; these are operator instructions, not checks performed by CI.

If an authorized rollout breaks customer flows, an authorized operator can restore that recorded version with `pnpm exec wrangler rollback VERSION_ID --name luluspeedworks --message 'Restore verified storefront version'`. For a separately configured named environment, use the same `--env` on every inspection and rollback command. A [Cloudflare rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) immediately changes the active deployment; it does not undo API data, orders, payments or connected resource changes. Verify compatibility before rollback and handle any commerce recovery through the API's existing operations.

After rollout or rollback, record the active version and check the target-domain homepage, a product deep link/reload, logo/assets, account/cookie behavior, keyboard/mobile layout and deterministic browsing with inference disabled. Run approved account/cart/checkout checks only in the selected integration environment. Check frontend/API failures, pending payment recovery and inference fallback/budget signals through the operator's configured observability. A failed critical identity or checkout gate keeps the release unapproved.

## Scope and references

- [Issue #13](https://github.com/benhalverson/luluspeedworks/issues/13) records the original scaffold acceptance contract.
- [Reviewed storefront specification](docs/reference/storefront-spec.md) records broader launch requirements and unresolved integration gates.
- [Design comparison and selected B](docs/reference/interface-designs.md) preserves the Pit Bench selection from prototype commit `ab6a17c3256c488dc1e9f5ec2803616793fb9696`.
- [Reference scope notes](docs/reference/README.md) distinguish historical plans from this frontend-only scaffold.
- [Engineering guidance](AGENTS.md) records mandatory React, accessibility and coverage requirements.
- [Review standards](CODING_STANDARDS.md) define cross-module behavior checks.

Reference documents preserve historical plans, not an inventory of completed features. Their earlier Hono/Worker requirements are superseded by this frontend-only repository. Use the source map and current task acceptance criteria for implementation. Test fixtures stay outside runtime code; live commerce, conversational interpretation and deployment require their own scope and verification.

## Inference budget fallback

Budget exhaustion and accounting outages retain the last valid A2UI surface and
shopping input. Direct catalog browsing and bag controls remain available. Streamed
fallbacks and recovered terminal run metadata show the same reason-specific state;
recovery reuses the unresolved run identity and does not automatically start another
inference run. Retrying requires an explicit shopper action.

The companion API scope ([#193](https://github.com/benhalverson/3dprinter-farm/issues/193))
owns atomic admission against the $20 UTC-month allowance, conservative reservation
reconciliation and durable $10/$15/$20 owner alerts. Admission controls are not a
provider billing guarantee. This frontend does not configure email addresses or
verify alert delivery. Configure and verify the sender, owner recipient, and email
delivery through the API deployment process.
