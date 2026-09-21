import { createComponentImplementation } from "@a2ui/react/v0_9";
import { Catalog, CommonSchemas, componentId } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

const PitBench = createComponentImplementation(
  {
    name: "PitBench",
    schema: z.object({
      header: componentId(),
      products: componentId(),
      focus: componentId(),
      configuration: componentId(),
      composer: componentId(),
    }),
  },
  ({ props, buildChild }) => (
    <div className="storefront">
      <a className="skip-link" href="#bench">
        Skip to the bench
      </a>
      {buildChild(props.header)}
      <main id="bench" tabIndex={-1}>
        <div className="bench-heading">
          <p className="eyebrow">THE PIT BENCH</p>
          <span>RC parts &amp; pit tools</span>
        </div>
        <div className="bench-grid">
          {buildChild(props.products)}
          {buildChild(props.focus)}
          {buildChild(props.configuration)}
          {buildChild(props.composer)}
        </div>
      </main>
      <footer>
        <span>LULU SPEEDWORKS</span>
        <p>A little more order. A little more race day.</p>
      </footer>
    </div>
  ),
);

const BrandHeader = createComponentImplementation(
  { name: "BrandHeader", schema: z.object({}) },
  () => (
    <header className="masthead">
      <a className="brand" href="/" aria-label="Lulu Speedworks home">
        <span className="logo-crop">
          <img
            src="/brand/lulu-logo.svg"
            alt="Lulu the dog with a racing badge"
            width="78"
            height="117"
          />
        </span>
        <span className="wordmark">
          LULU<span>SPEEDWORKS</span>
        </span>
      </a>
      <nav aria-label="Shop categories">
        <Button variant="outline" disabled>
          Shop all
        </Button>
        <Button variant="outline" disabled>
          RC parts
        </Button>
        <Button variant="outline" disabled>
          Pit tools
        </Button>
      </nav>
      <Button variant="outline" disabled aria-label="Shopping bag, 0 items">
        Bag <span className="bag-count">0</span>
      </Button>
    </header>
  ),
);

const ProductRail = createComponentImplementation(
  { name: "ProductRail", schema: z.object({}) },
  () => (
    <aside className="product-rail" aria-labelledby="products-title">
      <h2 id="products-title" className="eyebrow">
        THE PARTS DRAWER
      </h2>
      <div className="rail-count">
        <span>All products</span>
        <span>0</span>
      </div>
      <div className="rail-empty">
        <span className="drawer-mark" aria-hidden="true">
          +
        </span>
        <h3>No products yet</h3>
        <p>
          RC parts and pit tools will appear here when the catalog is available.
        </p>
      </div>
      <p className="rail-note">
        Small parts.
        <br />
        Big pit energy.
      </p>
    </aside>
  ),
);

const ProductFocus = createComponentImplementation(
  {
    name: "ProductFocus",
    schema: z.object({
      title: CommonSchemas.DynamicString,
      description: CommonSchemas.DynamicString,
    }),
  },
  ({ props }) => (
    <section className="product-focus" aria-labelledby="focus-title">
      <p className="eyebrow">YOUR NEXT RACE-DAY PROJECT</p>
      <h1 id="focus-title">{props.title}</h1>
      <div className="focus-art">
        <span className="cross top" aria-hidden="true">
          +
        </span>
        <span className="empty-part" aria-hidden="true">
          LS
        </span>
        <div>
          <h2>The bench is clear.</h2>
          <p>{props.description}</p>
        </div>
        <span className="cross bottom" aria-hidden="true">
          +
        </span>
      </div>
      <p className="focus-caption">
        Product details and compatibility will appear with your selection.
      </p>
    </section>
  ),
);

const Configuration = createComponentImplementation(
  { name: "Configuration", schema: z.object({}) },
  () => (
    <section className="configuration" aria-labelledby="configuration-title">
      <h2 id="configuration-title" className="eyebrow">
        MAKE IT YOURS
      </h2>
      <p className="configuration-empty">No part selected</p>
      <p>Select a product when the catalog is available to see its options.</p>
      <label htmlFor="color">Color</label>
      <Input id="color" placeholder="Choose a product first" disabled />
      <label htmlFor="quantity">Quantity</label>
      <Input id="quantity" type="number" placeholder="—" disabled />
      <Button className="add-button" disabled>
        Add to bag <span aria-hidden="true">↗</span>
      </Button>
      <p className="availability">Shopping is not available yet.</p>
    </section>
  ),
);

const ShoppingComposer = createComponentImplementation(
  { name: "ShoppingComposer", schema: z.object({}) },
  () => (
    <section className="composer" aria-labelledby="composer-title">
      <label id="composer-title" htmlFor="shopping-request">
        YOUR SHOPPING REQUEST
      </label>
      <div className="command-field">
        <span aria-hidden="true">&gt;_</span>
        <Input
          id="shopping-request"
          placeholder="What are you looking for?"
          aria-describedby="composer-help"
          disabled
        />
        <Button aria-label="Send shopping request" disabled>
          ↑
        </Button>
      </div>
      <p id="composer-help">
        Shopping requests will be available here when the store opens.
      </p>
    </section>
  ),
);

export const componentCatalog = new Catalog(
  "https://luluspeedworks.com/catalog/scaffold/v1",
  [
    PitBench,
    BrandHeader,
    ProductRail,
    ProductFocus,
    Configuration,
    ShoppingComposer,
  ],
);
