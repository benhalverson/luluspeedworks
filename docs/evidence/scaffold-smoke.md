# Issue #13 smoke evidence

Verified 2026-09-20 on the production Vite output served by `pnpm exec wrangler dev --local --port 8793`, using headless Chromium through Playwright. The Vite development surface on port 5193 also rendered successfully. No deployment was performed.

| Check | Desktop 1440 × 1000 | Mobile 390 × 844 | Narrow mobile 320 × 740 |
| --- | --- | --- | --- |
| Document width equals viewport | 1440 | 390 | 320 |
| Logo loaded with nonzero natural width | Pass | Pass | Pass |
| Barlow / Barlow Condensed loaded | Pass | Pass | Pass |
| All shopping buttons and inputs disabled | Pass | Pass | Pass |
| Tab focuses visible skip link | Pass | Pass | Pass |
| Focus outline is solid; link top is 12px | Pass | Pass | Pass |
| Enter moves focus to main bench | Pass | Pass | Pass |
| Browser console/page errors | 0 | 0 | 0 |
| Failed network requests | 0 | 0 | 0 |

Desktop presents the product rail, focus and configuration side by side, with the composer below the focus/configuration area. Mobile preserves the reading order: products, focused content, configuration, composer. Full-page screenshots were visually reviewed for spacing, clipping, branding and empty-state readability.

Rechecked after converting the component stylesheet to Tailwind utilities: the same checks pass at 1440, 1050, 850, 601, 600, 390 and 320px widths, including the tablet/mobile transition. The desktop and mobile region positions and sizes match the original captures. Screenshots below reflect the Tailwind implementation.

- [Desktop screenshot](desktop.svg)
- [Mobile screenshot](mobile.svg)

## Automated and packaging checks

`pnpm check` passed: Biome, strict TypeScript, seven Vitest tests and Vite production build. V8 reports 100% statements, branches, functions and lines for each of all seven runtime TS/TSX files, including `src/main.tsx`, Button, Input and the A2UI catalog/messages. Tests use the real renderer and verify a live data-model binding update and Strict Mode disposal/remount. The entrypoint spy delegates to the real React root.

`pnpm exec wrangler deploy --dry-run` passed with no bindings. The Workers configuration serves static assets and has no custom request handler.

## Reproduction

Run `pnpm install --frozen-lockfile`, `pnpm check`, then `pnpm exec wrangler dev --local`. Open the printed URL at the three viewport sizes above. Confirm the empty regions, loaded logo and fonts, disabled shopping controls and zero horizontal scroll. Reload and press Tab: the gold skip link must appear with a visible outline. Press Enter: focus moves to `main#bench`. Inspect the console and network panel for errors. No commerce or model behavior is expected.
