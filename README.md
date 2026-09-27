# Lulu Speedworks

Frontend-only React storefront for physical RC parts and pit tools. The selected **B — Pit Bench** storefront uses the real A2UI renderer with catalog browsing, product configuration, a persistent bag, account dialogs and password recovery. The private **Build Log** workspace provides administrator-authorized product conversations, draft editing and attachment controls.

These are frontend capabilities. Admin conversational interpretation, catalog publication/full CRUD and checkout are not completed by the current workspace. Backend integration and production readiness require separate verification.

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

The public build-time `VITE_API_ORIGIN` defaults to `https://api.benhalverson.dev`. For a separately running development API, run `VITE_API_ORIGIN=http://localhost:8787 pnpm dev`; that API must allow the frontend origin. This value is public and must contain no secrets. Public catalog reads omit credentials; auth, bag, profile and private draft requests include credentials. External presigned print uploads omit cookies. No proxy or backend is included. See the [source map](#source-map) for request contracts.

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
| `pnpm test:smoke` | Build and test production assets with controlled API responses in Chromium |

Runtime TypeScript/TSX coverage includes unimported application files, the entrypoint and local UI controls. Tests live outside `src`. GitHub Actions runs `pnpm check` (including local-link checks) and `pnpm test:smoke` for PRs and pushes to `main`, installing the frozen lockfile without production secrets.

## Production browser smoke checks

Install the pinned runner's browser once, then run the command:

```sh
pnpm exec playwright install chromium
pnpm test:smoke
```

On Linux CI, `pnpm exec playwright install --with-deps chromium` also installs system dependencies. [CI](.github/workflows/check.yml) uses this setup.

The runner builds into ignored `dist-smoke/`, pins the test API origin to `https://api.lulu.test`, and serves production assets at `http://127.0.0.1:4173`. API responses are controlled in browser tests; unhandled external requests fail the run. It refuses to reuse another server on that port. Playwright owns preview startup and teardown; intentional shutdown is normal cleanup, while test/startup failures retain a failing exit status.

Desktop (1440px) and mobile (390px) cases cover account/bag dialogs, shared logo loading, keyboard focus, page overflow, unexpected console errors, detail/save denial, delayed saves and authorization retry. These exercise the bundled React/A2UI/auth client with mocked API responses. They do not verify backend authorization enforcement, provider storage or live commerce.

Logs are retained in `artifacts/smoke/server.log`; the HTML report is in `artifacts/smoke/report/`, and failing tests retain screenshots and traces in `artifacts/smoke/results/`. CI uploads `artifacts/smoke/` even when the job fails. All artifacts are ignored by Git. To focus on a scenario, use `pnpm test:smoke --project=mobile -g 'delayed save'`.

## Source map

| Area | Entry points and boundaries |
| --- | --- |
| Routes and storefront orchestration | [App.tsx](src/App.tsx): product URLs, account routes, bag state and storefront A2UI surface |
| Catalog and rendering | [queries.ts](src/storefront/queries.ts), [api.ts](src/storefront/api.ts), [catalog.tsx](src/storefront/catalog.tsx), [messages.ts](src/storefront/messages.ts), [controller.ts](src/storefront/controller.ts) |
| Product configuration | [product.ts](src/storefront/product.ts): numeric product IDs, SKU-backed bag requests and API color IDs |
| Accounts and private bag state | [auth.ts](src/storefront/auth.ts), [account.tsx](src/storefront/account.tsx), [cart.ts](src/storefront/cart.ts), [profile.tsx](src/storefront/profile.tsx), [passkey.tsx](src/storefront/passkey.tsx) |
| Password recovery | [recovery.tsx](src/storefront/recovery.tsx): standalone request/reset routes |
| Admin access and draft workflow | [workspace.tsx](src/admin/workspace.tsx): identity-scoped verification, separate draft caches, private callbacks and recovery |
| Draft requests and attachments | [request.ts](src/admin/request.ts), [attachments.ts](src/admin/attachments.ts), [contracts.ts](src/admin/contracts.ts): protected API denial versus external transfer failure |
| Admin A2UI cards | [card.tsx](src/admin/card.tsx): renderer lifecycle and action bindings |
| Shared appearance | [brand-link.tsx](src/components/brand-link.tsx), [local controls](src/components/ui), [styles.css](src/styles.css): branding, shadcn controls, theme/base styles |
| Regression and browser tests | [test/](test), [smoke configuration](playwright.config.ts), [review standards](CODING_STANDARDS.md) |

## Rendering and design

`src/storefront/catalog.tsx` declares stable approved component implementations, including ProductEntry and CategoryControl. The root schema marks regional references with A2UI `componentId()`. Button and Input are minimal shadcn adaptations; `components.json` records the Tailwind/shadcn configuration.

Layout, typography, responsive variants and control overrides use Tailwind utilities. `src/styles.css` contains only shared theme tokens and base styles. Named `tablet`, `bench` and `wide` breakpoints preserve the selected design's region transitions.

`src/storefront/messages.ts` defines typed `createSurface`, `updateDataModel` and `updateComponents` messages. `controller.ts` owns the catalog snapshot, category and page, routing A2UI actions to data-model updates on one processor. Entries use a bound A2UI child template. `App` creates a controller in each effect setup and renders `A2uiSurface`. Cleanup aborts requests and disposes the surface group and action subscriptions; the renderer cleans up its node resolver. Strict Mode gets a fresh copy of initial messages. There is no bootstrap endpoint.

The adapter validates Zod DTOs, reads all API pages and detail memberships before publishing, and never converts server USD prices. Categories filter locally, ten products per UI page. Requests time out after ten seconds with manual Retry. Missing or ambiguous category mappings are unavailable; Shop all requires both RC Parts and Pit Tools (Pit Stuff is an accepted alias). Network fixtures exist only in tests.

Keep the pinned A2UI renderer/core, Zod and wire versions compatible. Dependency versions are recorded in [package.json](package.json) and [pnpm-lock.yaml](pnpm-lock.yaml); protocol messages use wire **v0.9.1**.

The supplied Lulu logo is embedded losslessly in `public/brand/lulu-logo.svg` as a self-contained PNG-backed SVG. Barlow and Barlow Condensed fonts are bundled through Fontsource. The combined [third-party licenses and notices](public/THIRD_PARTY_LICENSES.txt) ships with the built site at `/THIRD_PARTY_LICENSES.txt`.

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

## Scope and references

- [Issue #13](https://github.com/benhalverson/luluspeedworks/issues/13) records the original scaffold acceptance contract.
- [Reviewed storefront specification](docs/reference/storefront-spec.md) records broader launch requirements and unresolved integration gates.
- [Design comparison and selected B](docs/reference/interface-designs.md) preserves the Pit Bench selection from prototype commit `ab6a17c3256c488dc1e9f5ec2803616793fb9696`.
- [Reference scope notes](docs/reference/README.md) distinguish historical plans from this frontend-only scaffold.
- [Engineering guidance](AGENTS.md) records mandatory React, accessibility and coverage requirements.
- [Review standards](CODING_STANDARDS.md) define cross-module behavior checks.

Reference documents preserve historical plans, not an inventory of completed features. Their earlier Hono/Worker requirements are superseded by this frontend-only repository. Use the source map and current task acceptance criteria for implementation. Test fixtures stay outside runtime code; live commerce, conversational interpretation and deployment require their own scope and verification.
