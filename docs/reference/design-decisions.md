# Lulu Speedworks planning

Updated: 2026-09-20. Decision history supporting the [canonical storefront specification](storefront-spec.md). Product scope and B — Pit Bench are selected. The specification now defines implementation milestones and outstanding integration gates; this history is not a request to restart the interview.

These notes are temporarily outside the existing repositories. Move them into the new storefront repository when it is established. The existing `lulu` directory has not been selected as the new repository.

## Confirmed by the user

- Domain: luluspeedworks.com.
- Brand logo: the supplied Lulu Speedworks dog and racing badge image, at `/mnt/c/Users/Ben/Desktop/cars/lulu logo.png`.
- Curated catalog of physical products; customer model uploads are outside this storefront's current scope.
- A2UI is the primary storefront interface across browsing and purchasing. No “Help me choose” feature.
- The agent may compose shopping screens from approved storefront components rather than being restricted to predefined screen templates. The API remains authoritative for products, prices, available colors, and orders.
- Customers can use natural-language shopping requests alongside clickable A2UI controls in the same primary interface. The agent updates displayed products or selections in response; this is not a separate assistant panel.
- Routine clicks such as changing quantity, selecting color, and removing a cart item bypass model inference. Deterministic handlers call the commerce API as needed and update A2UI data or surfaces from confirmed results. The model handles natural-language requests and screen composition; A2UI remains the interface in both paths.
- Completing a purchase requires an explicit final confirmation button displaying the total. A natural-language request such as “buy it” prepares checkout but does not authorize payment; the customer reviews items, colors, shipping, and the total before confirming.
- The agent is store-focused: answers use verified catalog, store policy, and authorized customer order information. General RC advice is outside launch scope; missing compatibility information must remain unconfirmed rather than guessed.
- Each visit starts a fresh shopping conversation. Persistent conversation history is outside launch scope; cart and order persistence are separate concerns.
- Customers may select color, but not material. Material is fixed per product.
- Build in a new repository; the existing store repository may be consulted as a reference.
- Use the existing 3D printer API as the backend.
- Use React at the latest stable release available when scaffolding, TypeScript, Vite, Hono, and Cloudflare Workers. Start from the user's linked Cloudflare React + Vite guide and integrate Hono into the Worker.
- Use pnpm for package management and project commands.
- Use AG-UI to carry agent events, shared-state updates, and A2UI messages between the storefront agent and React frontend.
- Use Workers AI as the initial model provider, starting evaluation with `@cf/zai-org/glm-5.3-flash`. The user already has a Workers Paid plan. Production model suitability still needs validation against the storefront's A2UI and tool-use scenarios.
- Initial monthly model-inference budget: $20, separate from the existing Workers subscription. When tracked spend reaches the threshold, suspend additional model requests and alert the owner. Browsing, cart, and checkout remain available through predefined A2UI screens. This is accepted application behavior; spend accounting, concurrent-request handling, alert delivery, and billing reconciliation still need implementation validation. Do not claim a provider-enforced exact $20 billing cap.
- Send the owner email alerts at 50%, 75%, and 100% of the monthly inference budget: $10, $15, and $20 at the initial budget. Deduplicate each threshold alert within a budget month. Suspend further model requests at 100%; earlier alerts do not suspend inference. The recipient address remains to be configured.
- If model inference is unavailable, predefined A2UI screens keep browsing, cart, and checkout working through the commerce API. Natural-language requests show a retry message. The fallback remains A2UI and must not depend on a successful model call.
- Each product has a permanent, shareable URL that opens its A2UI product screen directly, including on a fresh visit without prior conversation history.
- Preserve existing same-browser cart persistence across visits, independently of fresh shopping conversations. This is existing behavior to retain, not a new feature decision.
- Customers must log in to an account before purchasing. Guest checkout is excluded.
- Customers may browse and add products to their cart before logging in. Login is required when proceeding to checkout.
- Signed-out visitors may use natural-language shopping requests, subject to per-visitor request limits. The limiter mechanism and threshold remain implementation details to validate against expected usage and the monthly inference budget.
- The prior conversation identifies a small RC ecommerce brand and explicitly rejects digital downloads in its final user correction.
- Launch categories are RC Parts and Pit Tools. Paint masks are excluded. Branded gear is deferred; the user will research it after launch. Branded stickers are included in that deferral, not a separate launch category.
- Starting product types: tool holders, pit stands, fan mounts, and fan shrouds. Exact designs and vehicle compatibility remain to be established.
- User-stated compatibility: the 1/10 fan mount fits any 1/10 motor; the 1/8 fan mount fits the Mugen MBX8; the fan shroud fits the Team Associated B6.4 or B7. Treat these as user-provided fit claims, not independently tested compatibility. The motor dimensions covered by “any 1/10 motor” remain to be specified before publishing a universal-fit claim.

Reference: [shared Lulu Speedworks conversation](https://chatgpt.com/share/6ab0533a-9954-83e8-86d9-ba707e43cfb4). Conversation content was read from the shared page's embedded data; assistant suggestions are not treated as user decisions.

## Proposals, not confirmed decisions

- Proposed grouping: tool holders and pit stands under Pit Tools; fan mounts and fan shrouds under RC Parts. Do not carry forward the prior assistant's Body & Paint Accessories or Lulu Gear categories.
- The prior assistant suggested Home, Shop, About Lulu, and Contact. Navigation remains unresolved.
- The visual treatment is now selected: B — Pit Bench, recorded in the prototype and canonical specification. Earlier visual proposals are superseded.
- React and AG-UI are selected; the specific A2UI renderer package and version still need compatibility validation.
- The agent runtime and specific renderer integration remain unresolved technical decisions. Preserve the existing cart behavior rather than reopening it as a product decision.
- Workers AI and GLM 5.3 Flash are accepted as the initial evaluation choice. Qwen 3.8 27B and Gemini 3.8 Flash remain comparison candidates, not configured fallbacks or additional providers selected for implementation. Cloudflare documents function calling and streaming for both hosted candidates; this does not establish reliable A2UI schema adherence. Compare valid rendered screens, correct tool arguments, response latency, and cost per completed shopping flow including retries. No runtime evaluation has been performed.

Cloudflare references checked 2026-09-20: [GLM 5.3 Flash](https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/) lists $0.15/M input and $0.50/M output tokens and requires Workers Paid or prepaid AI Gateway credits; [Qwen 3.8 27B](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/) lists $0.45/M input and $3.20/M output tokens. These are uncached token rates. Both pages identify the models as Cloudflare-hosted and show AI binding usage. [Workers bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/) provide direct access from the storefront Worker; using these models does not require opening a separate model-provider account.

Provider references checked 2026-09-20: [A2UI quickstart](https://a2ui.org/quickstart/), [Gemini models](https://ai.google.dev/gemini-api/docs/models), [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output), [model details and introductory pricing](https://ai.google.dev/gemini-api/docs/latest-model). Published introductory Gemini 3.8 Flash pricing is $0.75 per million input tokens and $3.75 per million output tokens through 2026-12-31; announced standard rates from 2027-01-01 are $1.50 and $7.50 respectively. Recheck pricing at implementation time.

## Current specification status

The consolidated specification maps the user-supplied [published API documentation](https://api.benhalverson.dev/docs), supplemented by explicitly labeled local-code details. It records protocol validation, authentication/domain integration, and authoritative shipping/payment totals as integration gates. Published checkout currently uses Stripe; the separate planned Square replacement is not a required storefront migration.

## Existing cart and login behavior verified in source

Checked 2026-09-20 in the current local checkouts; source inspection, not a runtime test:

- `store/src/context/CartContext.tsx`: restores cart contents from `localStorage`, persists changes under `cart`, reuses the stored `cartId`, and broadcasts cart updates across tabs. Calls `/cart/create` only when a stored ID is absent and posts items to `/cart/add`.
- `3dprinter-web-api/src/db/schema.ts`: stores cart rows with cart ID, SKU, quantity, color, filament type, and filament ID.
- `3dprinter-web-api/src/routes/shoppingCart.ts`: `/cart/add` inserts or updates database rows; `GET /cart/:cartId` reads them and joins current product information. `/cart/:cartId/checkout` requires authentication.
- `store/src/App.tsx` and `src/components/ProtectedRoute.tsx`: checkout is protected; a signed-out visit redirects to sign-in while preserving the destination. `src/pages/Signin.tsx` reads and validates that return destination.
- The new A2UI client should preserve these established behaviors. Cart persistence does not depend on preserving agent conversation history.

## Verified starter references

- [Cloudflare React + Vite guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/) documents `pnpm create cloudflare@latest my-react-app --framework=react`, a React SPA, a Worker entrypoint, and the Cloudflare Vite plugin. The [actual starter source](https://github.com/cloudflare/templates/tree/main/vite-react-template) includes Hono, verified while preparing the initial prototype.
- React's npm `latest` tag returned `19.3.0` on 2026-09-20. The throwaway prototype has been scaffolded; recheck React and React DOM stable versions when scaffolding the production application and commit the resolved pnpm lockfile.

## Parked questions

- The user asked to move on from motor-diameter details. Retain the supplied compatibility descriptions and do not block design discussion on measurements.
- The earlier visual-design deferral was superseded by the user's explicit prototype request and selection of B — Pit Bench. Do not reopen the selected direction.
- The user objected to being asked about cart persistence already present in the API/store. Inspect available code before asking questions that existing implementation can answer.
