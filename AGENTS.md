# Storefront engineering guidance

This repository is frontend-only. Keep runtime code under `src/`. No Hono, API endpoints, custom Worker request handlers, commerce credentials, model calls, or health endpoint belong here. Future endpoint work uses a dedicated branch in `~/projects/3dprinter-web-api` and its existing health endpoint.

Use a dedicated feature branch in the main checkout. Do not create worktrees. Follow the selected B — Pit Bench design, with the specification's broader integration milestones kept separate from scaffold delivery. Do not promote prototype fixtures, variant switching, scripted shopping, or simulated payments.

Do not create evidence documents or review-report files, including `docs/*evidence*` and `docs/*reviews*`, unless the user explicitly requests those files. Report validation results and review findings in the conversation instead.

Use Node 24.18.0, pnpm 10.23.0, TypeScript 7, React, Vite, Tailwind and shadcn. Biome exclusively owns linting and formatting; keep its recommended React and accessibility rules enabled. Commit the resolved lockfile. Keep Zod 3.25.76 with the pinned A2UI renderer/core and wire version until compatibility is revalidated.

Use the active shell's Node and pnpm executables. Do not prepend commands with `source /home/ben/.nvm/nvm.sh` or `nvm use`. Check `node --version` and `pnpm --version` directly when version verification is needed.

Use Tailwind utilities for component layout, typography, responsive behavior and interaction states. Reuse the local shadcn controls and their `className` overrides. Keep `src/styles.css` limited to shared theme tokens and base styles; do not introduce parallel component-class stylesheets.

Follow React best practices always: stable module-level component definitions/catalogs, minimal state, derive values instead of duplicating state, pure rendering, effect-owned external resources with symmetric cleanup, and Strict Mode enabled. Avoid speculative memoization and unnecessary effects. Use schema-derived types, semantic landmarks, labeled native controls, visible keyboard focus, and responsive layouts.

Vitest with React Testing Library/jsdom and V8 must maintain **100% statements, branches, functions, and lines globally and per file**. `src/**/*.{ts,tsx}` includes unimported files, entrypoints, and local UI components. Only tests, configuration, generated declarations, dependencies, and build artifacts may be outside coverage. No coverage-ignore comments, lowered thresholds, or runtime-file exclusions. Test the real A2UI renderer, bindings, empty states, disabled controls and Strict Mode teardown.

Run `pnpm check` before delivery. Smoke-check production assets at desktop and mobile sizes, logo loading, keyboard focus, page overflow and console errors. CI must run without production credentials. Production deployment, domain changes and live commerce require separate scope.

When changing session, cache or mutation behavior, use the request-ordering scenarios in [review standards](CODING_STANDARDS.md). Before delivery, run `pnpm test:smoke` and report the separate verification states defined in the [delivery workflow](README.md#delivery-workflow). Reviewers read `CODING_STANDARDS.md`; use the README source map when navigating the app.
