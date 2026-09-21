# Lulu Speedworks

Frontend-only React storefront for physical RC parts and pit tools. The selected **B — Pit Bench** layout renders an empty initial surface through the official A2UI renderer. Shopping controls and the integrated composer are disabled until their integrations exist.

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

Use Node **24.18.0** and pnpm **10.23.0**. Vite prints the local URL (normally `http://localhost:5173`). No environment variables, API server, Cloudflare login, prototype checkout, or external asset directory are needed.

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

`src/storefront/catalog.tsx` declares six stable approved component implementations: PitBench, BrandHeader, ProductRail, ProductFocus, Configuration and ShoppingComposer. The root schema marks regional references with A2UI `componentId()`. Button and Input are minimal shadcn adaptations; `components.json` records the Tailwind/shadcn configuration.

Layout, typography, responsive variants and control overrides use Tailwind utilities. `src/styles.css` contains only shared theme tokens and base styles. Named `tablet`, `bench` and `wide` breakpoints preserve the selected design's region transitions.

`src/storefront/messages.ts` defines typed `createSurface`, `updateDataModel` and `updateComponents` messages. The focused title and description bind to data-model paths. `App` creates a fresh processor in each effect setup, feeds those local messages into it and renders `A2uiSurface`. Cleanup disposes the surface group; the official renderer owns and cleans up its node resolver subscriptions. Strict Mode replay therefore receives a fresh model instead of reusing a disposed one. There is no bootstrap endpoint.

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
