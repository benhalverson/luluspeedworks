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
    <div className="mx-auto min-h-dvh max-w-[1550px] px-4.5 tablet:px-[4%]">
      <a
        className="absolute -top-25 left-4 z-10 bg-primary p-3 text-primary-foreground focus:top-3"
        href="#bench"
      >
        Skip to the bench
      </a>
      {buildChild(props.header)}
      <main id="bench" tabIndex={-1}>
        <div className="flex items-center justify-between gap-3 py-5.5 tablet:gap-0 tablet:py-6.5">
          <p className="text-[11px] font-semibold leading-normal tracking-[0.14em]">
            THE PIT BENCH
          </p>
          <span className="text-[10px] text-muted-foreground tablet:text-[12px]">
            RC parts &amp; pit tools
          </span>
        </div>
        <div className="flex flex-col gap-6 tablet:grid tablet:grid-cols-[minmax(0,1fr)_250px] tablet:gap-5 bench:grid-cols-[180px_minmax(0,1fr)_230px] wide:grid-cols-[235px_minmax(0,1fr)_270px] wide:gap-7.5 [&>*]:min-w-0">
          {buildChild(props.products)}
          {buildChild(props.focus)}
          {buildChild(props.configuration)}
          {buildChild(props.composer)}
        </div>
      </main>
      <footer className="mt-9 flex flex-col items-start justify-between gap-2 border-t border-border pt-6 pb-7.5 tablet:flex-row tablet:items-center tablet:gap-5">
        <span className="font-display text-[18px] font-semibold tracking-[0.05em]">
          LULU SPEEDWORKS
        </span>
        <p className="text-[12px] text-muted-foreground">
          A little more order. A little more race day.
        </p>
      </footer>
    </div>
  ),
);

const BrandHeader = createComponentImplementation(
  { name: "BrandHeader", schema: z.object({}) },
  () => (
    <header className="flex min-h-22 items-center gap-3 border-b border-border tablet:min-h-26 tablet:gap-4.5 wide:gap-8">
      <a
        className="flex shrink-0 items-center gap-3"
        href="/"
        aria-label="Lulu Speedworks home"
      >
        <span className="relative h-13 w-11 overflow-hidden rounded-full bg-white tablet:h-18.5 tablet:w-16">
          <img
            className="absolute -top-3.25 -left-1.75 h-auto w-14.75 max-w-none tablet:-top-4.25 tablet:w-19.5"
            src="/brand/lulu-logo.svg"
            alt="Lulu the dog with a racing badge"
            width="78"
            height="117"
          />
        </span>
        <span className="-skew-x-7 font-display text-[29px] font-bold leading-[0.8] tablet:text-[36px]">
          LULU
          <span className="mt-1.75 block text-[10px] tracking-[0.12em] tablet:text-[12px]">
            SPEEDWORKS
          </span>
        </span>
      </a>
      <nav
        className="mr-auto hidden gap-1 tablet:flex wide:ml-6 wide:gap-2"
        aria-label="Shop categories"
      >
        <Button className="px-2 wide:px-4" variant="outline" disabled>
          Shop all
        </Button>
        <Button className="px-2 wide:px-4" variant="outline" disabled>
          RC parts
        </Button>
        <Button className="px-2 wide:px-4" variant="outline" disabled>
          Pit tools
        </Button>
      </nav>
      <Button
        className="ml-auto"
        variant="outline"
        disabled
        aria-label="Shopping bag, 0 items"
      >
        Bag{" "}
        <span className="rounded-[3px] bg-primary px-1.25 text-primary-foreground">
          0
        </span>
      </Button>
    </header>
  ),
);

const ProductRail = createComponentImplementation(
  { name: "ProductRail", schema: z.object({}) },
  () => (
    <aside
      className="col-span-full border-b border-border pb-5 bench:col-span-1 bench:row-span-2 bench:border-r bench:border-b-0 bench:pr-6 bench:pb-0"
      aria-labelledby="products-title"
    >
      <h2
        id="products-title"
        className="text-[11px] font-semibold leading-normal tracking-[0.14em] text-subtle"
      >
        THE PARTS DRAWER
      </h2>
      <div className="flex justify-between border-b border-border py-3 text-[12px] text-muted-foreground bench:pt-5.5 bench:pb-4">
        <span>All products</span>
        <span>0</span>
      </div>
      <div className="pt-4 bench:py-8">
        <span
          className="hidden text-[32px] font-normal text-primary bench:inline"
          aria-hidden="true"
        >
          +
        </span>
        <h3 className="mb-2 text-[16px] font-medium bench:mt-3">
          No products yet
        </h3>
        <p className="text-[13px] leading-[1.6] text-muted-foreground">
          RC parts and pit tools will appear here when the catalog is available.
        </p>
      </div>
      <p className="hidden pt-9.5 font-display text-[25px] leading-[1.1] text-caption bench:block">
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
    <section aria-labelledby="focus-title">
      <p className="text-[10px] font-semibold leading-normal tracking-[0.14em] text-muted-foreground">
        YOUR NEXT RACE-DAY PROJECT
      </p>
      <h1
        id="focus-title"
        className="mt-2.25 mb-6 font-display text-[clamp(38px,4vw,56px)] font-semibold leading-[1.1]"
      >
        {props.title}
      </h1>
      <div className="relative flex min-h-65 flex-col items-center justify-center gap-4.5 rounded-[5px] border border-border bg-muted px-6.25 py-10 text-center tablet:min-h-77.5">
        <span
          className="absolute top-2.5 left-4.5 text-[20px] text-marker"
          aria-hidden="true"
        >
          +
        </span>
        <span
          className="-skew-x-7 font-display text-[64px] font-bold leading-none text-watermark"
          aria-hidden="true"
        >
          LS
        </span>
        <div>
          <h2 className="font-display text-[26px] font-semibold">
            The bench is clear.
          </h2>
          <p className="mt-2 max-w-67.5 text-[13px] leading-[1.6] text-muted-foreground">
            {props.description}
          </p>
        </div>
        <span
          className="absolute right-4.5 bottom-2.5 text-[20px] text-marker"
          aria-hidden="true"
        >
          +
        </span>
      </div>
      <p className="mt-4 text-[12px] leading-[1.6] text-muted-foreground">
        Product details and compatibility will appear with your selection.
      </p>
    </section>
  ),
);

const Configuration = createComponentImplementation(
  { name: "Configuration", schema: z.object({}) },
  () => (
    <section
      className="w-full self-start rounded-[7px] border border-border bg-card p-5.5 tablet:p-4.5 wide:p-6"
      aria-labelledby="configuration-title"
    >
      <h2
        id="configuration-title"
        className="text-[11px] font-semibold leading-normal tracking-[0.14em]"
      >
        MAKE IT YOURS
      </h2>
      <p className="mt-4.5 mb-2.5 font-display text-[28px] leading-[1.2]">
        No part selected
      </p>
      <p className="text-[13px] leading-[1.6] text-muted-foreground">
        Select a product when the catalog is available to see its options.
      </p>
      <label className="mt-6 mb-2.25 block text-[12px]" htmlFor="color">
        Color
      </label>
      <Input
        className="text-[12px]"
        id="color"
        placeholder="Choose a product first"
        disabled
      />
      <label className="mt-6 mb-2.25 block text-[12px]" htmlFor="quantity">
        Quantity
      </label>
      <Input
        className="text-[12px]"
        id="quantity"
        type="number"
        placeholder="—"
        disabled
      />
      <Button className="mt-7 mb-2.5 w-full justify-between" disabled>
        Add to bag <span aria-hidden="true">↗</span>
      </Button>
      <p className="text-center text-[11px] leading-[1.6] text-muted-foreground">
        Shopping is not available yet.
      </p>
    </section>
  ),
);

const ShoppingComposer = createComponentImplementation(
  { name: "ShoppingComposer", schema: z.object({}) },
  () => (
    <section
      className="col-span-full pt-0.5 bench:col-span-2 bench:col-start-2"
      aria-labelledby="composer-title"
    >
      <label
        className="text-[10px] tracking-[0.12em] text-muted-foreground"
        id="composer-title"
        htmlFor="shopping-request"
      >
        YOUR SHOPPING REQUEST
      </label>
      <div className="mt-2.5 flex items-center gap-2 rounded-[7px] border border-input bg-muted py-2.25 pr-2.5 pl-3 tablet:gap-3 tablet:pl-4.5">
        <span className="font-mono text-primary" aria-hidden="true">
          &gt;_
        </span>
        <Input
          className="border-0 p-0 text-[12px] tablet:text-base"
          id="shopping-request"
          placeholder="What are you looking for?"
          aria-describedby="composer-help"
          disabled
        />
        <Button aria-label="Send shopping request" disabled>
          ↑
        </Button>
      </div>
      <p
        className="pt-2.5 text-[11px] text-muted-foreground"
        id="composer-help"
      >
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
