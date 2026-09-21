# Lulu Speedworks

Frontend-only React storefront for physical RC parts and pit tools. The selected **B — Pit Bench** layout browses the live catalog through the official A2UI renderer. Product selection, configuration, bag and composer remain scaffolded.

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

Use Node **24.18.0** and pnpm **10.23.0**. Development and `pnpm exec vite preview` use `http://localhost:3000`, an origin accepted by the live API. Ports are strict to prevent silently switching to an origin without CORS access.

The public build-time `VITE_API_ORIGIN` defaults to `https://api.benhalverson.dev`. For a separately running development API, run `VITE_API_ORIGIN=http://localhost:8787 pnpm dev`; that API must allow the frontend origin. This value is public and must contain no secrets. Requests omit credentials; no proxy or backend is included. See [catalog contract and live dependencies](docs/catalog-contract.md).

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the local frontend with Vite |
| `pnpm lint` | Non-mutating Biome lint and format checks |
| `pnpm format` | Apply Biome formatting |
| `pnpm typecheck` | Strict TypeScript checks |
| `pnpm test` | Run Vitest once |
| `pnpm test:coverage` | Enforce 100% statements, branches, functions and lines per file and globally |
| `pnpm build` | Build static frontend assets into `dist/` |
| `pnpm check` | Run Biome, type checking, coverage and build |

Runtime TypeScript/TSX coverage includes unimported application files, the entrypoint and local UI controls. Tests live outside `src`. GitHub Actions runs `pnpm check` for PRs and pushes to `main`, installing the frozen lockfile without production secrets.

## Rendering and design

`src/storefront/catalog.tsx` declares stable approved component implementations, including ProductEntry and CategoryControl. The root schema marks regional references with A2UI `componentId()`. Button and Input are minimal shadcn adaptations; `components.json` records the Tailwind/shadcn configuration.

Layout, typography, responsive variants and control overrides use Tailwind utilities. `src/styles.css` contains only shared theme tokens and base styles. Named `tablet`, `bench` and `wide` breakpoints preserve the selected design's region transitions.

`src/storefront/messages.ts` defines typed `createSurface`, `updateDataModel` and `updateComponents` messages. TanStack Query **5.103.1** owns server data, requests, caching and cancellation in `queries.ts`. `App` holds category/page selection and derives the complete snapshot from query results. `controller.ts` publishes that view through one stable processor and forwards A2UI actions to React setters or Retry. Entries use a bound A2UI child template. Each effect setup owns its processor; cleanup disposes the surface group and action subscriptions, while TanStack cancels unused requests and the renderer cleans up its node resolver. Strict Mode gets a fresh copy of initial messages. There is no bootstrap endpoint.

The adapter validates Zod DTOs, reads all API pages and detail memberships before publishing, and never converts server USD prices. Categories filter locally, ten products per UI page. Requests time out after ten seconds with manual Retry. Missing or ambiguous category mappings are unavailable; Shop all requires both RC Parts and Pit Tools (Pit Stuff is an accepted alias). Network fixtures exist only in tests.

Pinned protocol set: `@a2ui/react` **0.11.1**, `@a2ui/web_core` **0.11.0**, Zod **3.25.76**, wire **v0.9.1**. React/React DOM **19.3.0**, TypeScript **7.0.2** and matching Vitest/V8 **5.0.1** were verified against npm's stable tags on 2026-09-20.

The supplied Lulu logo is embedded losslessly in `public/brand/lulu-logo.svg` as a self-contained PNG-backed SVG. Barlow and Barlow Condensed fonts are bundled through Fontsource. The combined [third-party licenses and notices](public/THIRD_PARTY_LICENSES.txt) ships with the built site at `/THIRD_PARTY_LICENSES.txt`.

## Static hosting

This adapts the [Cloudflare React/Vite starter](https://github.com/cloudflare/templates/tree/main/vite-react-template) for [Workers static assets](https://developers.cloudflare.com/workers/static-assets/get-started/): keep the React/Vite browser build, remove the example API/Hono Worker, and use an assets-only `wrangler.jsonc`. No custom request handler or Cloudflare Vite Worker environment is necessary. The asset directory is `dist`, with SPA fallback. Unknown document URLs show the scaffold; product routes are not implemented yet.

After building, `pnpm exec wrangler dev --local` can preview the static hosting configuration, and `pnpm exec wrangler deploy --dry-run` validates packaging without publishing. Actual deployment and domain configuration are outside #13. No backend credentials or bindings are configured. Future endpoint work belongs on a dedicated branch in `3dprinter-web-api`; reuse its existing health endpoint.

## Scope and references

- [Issue #13](https://github.com/benhalverson/luluspeedworks/issues/13) is the scaffold acceptance contract.
- [Reviewed storefront specification](docs/reference/storefront-spec.md) records broader launch requirements and unresolved integration gates.
- [Design comparison and selected B](docs/reference/interface-designs.md) preserves the Pit Bench selection from prototype commit `ab6a17c3256c488dc1e9f5ec2803616793fb9696`.
- [Reference scope notes](docs/reference/README.md) distinguish historical plans from this frontend-only scaffold.
- [Engineering guidance](AGENTS.md) records mandatory React, accessibility and coverage requirements.
- [Desktop/mobile smoke evidence](docs/evidence/scaffold-smoke.md) records browser checks and screenshots.

No catalog fixtures, scripted shopping, variant switching, accounts, checkout simulation, live agent integration or production deployment are included.
