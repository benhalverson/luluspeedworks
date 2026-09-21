# Lulu Speedworks: initial interface prototype

**Question:** Which primary A2UI shopping experience makes browsing, configuration, and cart actions easiest to understand through both clicks and typed requests?

This is a throwaway design comparison, not a production storefront. All variants use the Lulu Speedworks identity and the same fixture catalog: tool holders, pit stands, 1/10 motor fan mounts, Mugen MBX8 fan mounts, and Team Associated B6.4/B7 fan shrouds. Customers choose color; material selection is outside scope.

The signatures below are proposed module boundaries for comparison, not a claim that the prototype implements these interfaces verbatim. `Surface` means renderer-ready A2UI data, and `Snapshot` means the relevant shopping state exposed for inspection.

## A — Paddock Catalog

A light, editorial catalog with black navigation and gold accents. An integrated command field sits above a scannable product grid. Product selection reveals a focused detail surface while retaining catalog context; the cart uses a sheet. Typed requests reshape the storefront rather than opening an assistant sidebar.

### Signature

```ts
type Intent =
  | { kind: "request"; text: string }
  | { kind: "select"; productId: string }
  | { kind: "color"; productId: string; colorId: string }
  | { kind: "add"; productId: string; quantity: number }
  | { kind: "cart" };

interface CatalogSession {
  dispatch(intent: Intent): Promise<void>;
  subscribe(render: (view: { surface: Surface; state: Snapshot }) => void): () => void;
}
```

### Usage

```ts
const stop = catalog.subscribe(renderCatalog);
await catalog.dispatch({ kind: "request", text: "Show MBX8 fan mounts" });
await catalog.dispatch({ kind: "select", productId: "mbx8-mount" });
```

The module hides product lookup, intent interpretation, selection validation, surface composition, and cart transitions. A single published view keeps callers simple. This design prioritizes scanning and familiar shopping behavior, but typed requests must meaningfully change the visible surface or the experience will feel like a conventional catalog search.

## B — Pit Bench

A dark, three-column workbench: compact product rail on the left, a large focused product with compatibility information in the center, and configuration on the right. A persistent command composer sits below. It avoids the product grid and emphasizes working on one selection at a time.

### Signature

```ts
type BenchIntent = Intent | { kind: "focus-region"; region: "products" | "details" | "configuration" };
type BenchView = {
  products: Surface;
  details: Surface;
  configuration: Surface;
  state: Snapshot;
};

interface BenchSession {
  dispatch(intent: BenchIntent): Promise<void>;
  subscribe(render: (view: BenchView) => void): () => void;
}
```

### Usage

```ts
const stop = bench.subscribe(renderBenchRegions);
await bench.dispatch({ kind: "select", productId: "mbx8-mount" });
await bench.dispatch({ kind: "color", productId: "mbx8-mount", colorId: "black" });
```

The module hides coordination between the product rail, compatibility view, and configuration controls. It publishes coherent region state so the caller does not reconcile a selected product with stale color controls. This offers flexibility and keeps configuration visible, but the larger rendering contract and responsive region arrangement increase complexity. On small screens the regions need a clear reading order.

## C — Trackside Canvas

A full-width shopping canvas displays one dominant collection, product, or cart surface. A journey breadcrumb gives orientation, a horizontal product runway supports discovery, and a persistent bottom composer makes typed requests part of the primary interaction. There is no separate assistant panel.

### Signature

```ts
type Destination =
  | { kind: "collection"; collectionId: string }
  | { kind: "product"; productId: string }
  | { kind: "cart" };

interface CanvasSession {
  dispatch(intent: Intent): Promise<void>;
  revisit(destination: Destination): Promise<void>;
  subscribe(render: (view: {
    surface: Surface;
    journey: Destination[];
    state: Snapshot;
  }) => void): () => void;
}
```

### Usage

```ts
const stop = canvas.subscribe(renderCanvas);
await canvas.dispatch({ kind: "request", text: "Show pit tools" });
await canvas.revisit({ kind: "product", productId: "pit-stand" });
```

The module hides interpretation, active-surface transitions, and navigation history. `revisit` names a destination explicitly so breadcrumb navigation can restore a view without replaying an add-to-cart action. Its main risk is lost orientation when the canvas changes; the journey and visible state need to make each transition understandable.

## Comparison and recommendation

A has the simplest familiar shopping contract and is strongest for scanning a catalog. B exposes more structure and is strongest for configuration, where product, fit, and color need to remain visible together. Its flexibility comes with more coordination responsibility inside the module and more rendering work for callers.

C is the strongest initial candidate for an agent-primary interface: clicks and typed requests operate the same dominant surface. Its extra navigation method adds a small amount of interface surface while hiding meaningful history and action-replay complexity. A can preserve broader visual context more naturally; C must earn that clarity through explicit navigation.

Routine clicks should remain deterministic in every design. The interface shapes allow those actions to avoid a model call while keeping typed intent interpretation internal. B allows region-specific rendering; A and C simplify callers by publishing a primary view. These are design capabilities, not measured performance results.

## Selected direction — B: Pit Bench

On 2026-09-20, the user selected B: “lets go with B.” This supersedes the initial recommendation of C above. The selected structure is the product rail, focused product area, and visible configuration panel, with an integrated shopping composer. No further rationale was supplied.

B is now the default prototype. A and C remain available as reference variants on the throwaway branch. This records design selection, not production readiness or live API/agent acceptance; the selected direction still needs production implementation.

## Prototype boundaries and capture

The app uses the official `@a2ui/react` and `@a2ui/web_core` native renderer with custom shadcn components. Typed commands are locally scripted; there is no live GLM model or AG-UI connection. Products and prices are fixtures, state stays in memory, and authentication and payment are not implemented.

Capture the prototype on `prototype/initial-design`, outside a production main branch. No implementation issue exists yet; the repository README serves as the context pointer to this branch and document. Record the user's eventual verdict before treating any design choice as validated.
