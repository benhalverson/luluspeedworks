import { createComponentImplementation } from "@a2ui/react/v0_9";
import { Catalog, CommonSchemas, componentId } from "@a2ui/web_core/v0_9";
import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";
import { Button } from "../components/ui/button";
import { DialogContent } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { AccountPanel } from "./account";
import { authClient, returnDestination } from "./auth";

function AccountDialog() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return (
    <Dialog.Root
      open={["/signin", "/signup", "/profile"].includes(pathname)}
      onOpenChange={() => navigate(returnDestination(params.get("returnTo")))}
    >
      <DialogContent
        title="Your account"
        description="Manage your sign-in and shipping details."
      >
        <AccountPanel />
      </DialogContent>
    </Dialog.Root>
  );
}

/**
 * Converts A2UI child references to arguments for `buildChild(id, basePath)`.
 * Static children use string IDs; repeated entries include a `basePath`
 * that must be preserved to bind each entry to its own product.
 */
function childReference(
  child: string | { id: string; basePath: string },
): [string, string?] {
  return typeof child === "string" ? [child] : [child.id, child.basePath];
}

const PitBench = createComponentImplementation(
  {
    name: "PitBench",
    schema: z.object({
      header: componentId(),
      products: componentId(),
      focus: componentId(),
      configuration: componentId(),
      composer: componentId(),
      cart: componentId(),
    }),
  },
  ({ props, buildChild }) => (
    <Dialog.Root>
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
        {buildChild(props.cart)}
        <AccountDialog />
        <footer className="mt-9 flex flex-col items-start justify-between gap-2 border-t border-border pt-6 pb-7.5 tablet:flex-row tablet:items-center tablet:gap-5">
          <span className="font-display text-[18px] font-semibold tracking-[0.05em]">
            LULU SPEEDWORKS
          </span>
          <p className="text-[12px] text-muted-foreground">
            A little more order. A little more race day.
          </p>
        </footer>
      </div>
    </Dialog.Root>
  ),
);

const BrandHeader = createComponentImplementation(
  {
    name: "BrandHeader",
    schema: z.object({ count: CommonSchemas.DynamicNumber }),
  },
  ({ props }) => {
    const location = useLocation();
    const session = authClient.useSession();
    return (
      <header className="flex min-h-22 items-center gap-3 border-b border-border tablet:min-h-26 tablet:gap-4.5 wide:gap-8">
        <Link
          className="flex shrink-0 items-center gap-3"
          to="/"
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
        </Link>
        <nav
          aria-label="Account and bag"
          className="ml-auto flex items-center gap-2"
        >
          <Link
            className="rounded px-3 py-2 text-sm"
            to={`${session.data?.user ? "/profile" : "/signin"}?returnTo=${encodeURIComponent(location.pathname)}`}
          >
            Account
          </Link>
          <Dialog.Trigger asChild>
            <Button variant="outline" aria-label={`Bag (${props.count})`}>
              Bag{" "}
              <span className="rounded bg-primary px-1.5 text-xs text-primary-foreground">
                {props.count}
              </span>
            </Button>
          </Dialog.Trigger>
        </nav>
      </header>
    );
  },
);

const ProductRail = createComponentImplementation(
  {
    name: "ProductRail",
    schema: z.object({
      controls: z.array(componentId()),
      entries: CommonSchemas.ChildList,
      status: CommonSchemas.DynamicString,
      paging: CommonSchemas.DynamicString,
      previousDisabled: CommonSchemas.DynamicBoolean,
      nextDisabled: CommonSchemas.DynamicBoolean,
      retryVisible: CommonSchemas.DynamicBoolean,
      previous: CommonSchemas.Action,
      next: CommonSchemas.Action,
      retry: CommonSchemas.Action,
    }),
  },
  ({ props, buildChild }) => (
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
      <nav aria-label="Shop categories" className="flex flex-wrap gap-2 py-4">
        {props.controls.map((child) => buildChild(...childReference(child)))}
      </nav>
      <p
        role="status"
        aria-label="Catalog status"
        aria-live="polite"
        aria-atomic="true"
        className="py-3 text-[13px] leading-relaxed text-muted-foreground"
      >
        {props.status}
      </p>
      {props.retryVisible ? (
        <Button variant="outline" onClick={props.retry}>
          Retry
        </Button>
      ) : null}
      <ul
        aria-label="Catalog products"
        className="grid gap-4 tablet:grid-cols-2 bench:grid-cols-1"
      >
        {props.entries.map((child) => buildChild(...childReference(child)))}
      </ul>
      <nav
        className="mt-4 flex flex-wrap items-center gap-2"
        aria-label="Catalog pagination"
      >
        <p className="w-full text-xs text-muted-foreground">{props.paging}</p>
        <Button
          className="px-2"
          variant="outline"
          disabled={props.previousDisabled}
          onClick={props.previous}
        >
          Previous
        </Button>
        <Button
          className="px-2"
          variant="outline"
          disabled={props.nextDisabled}
          onClick={props.next}
        >
          Next
        </Button>
      </nav>
      <p className="hidden pt-9.5 font-display text-[25px] leading-[1.1] text-caption bench:block">
        Small parts.
        <br />
        Big pit energy.
      </p>
    </aside>
  ),
);

const CategoryControl = createComponentImplementation(
  {
    name: "CategoryControl",
    schema: z.object({
      label: z.string(),
      selected: CommonSchemas.DynamicBoolean,
      action: CommonSchemas.Action,
    }),
  },
  ({ props }) => (
    <Button
      className="px-2 text-xs"
      variant="outline"
      aria-pressed={props.selected}
      onClick={props.action}
    >
      {props.label}
    </Button>
  ),
);

export function ProductImage({ src, name }: { src: string; name: string }) {
  const [broken, setBroken] = useState(false);
  return src && !broken ? (
    <img
      src={src}
      alt={name}
      onError={() => setBroken(true)}
      className="aspect-[4/3] w-full rounded border border-border object-contain"
    />
  ) : (
    <div className="flex aspect-[4/3] items-center justify-center rounded border border-border bg-muted text-xs text-muted-foreground">
      Image unavailable
    </div>
  );
}

const ProductEntry = createComponentImplementation(
  {
    name: "ProductEntry",
    schema: z.object({
      name: CommonSchemas.DynamicString,
      description: CommonSchemas.DynamicString,
      image: CommonSchemas.DynamicString,
      price: CommonSchemas.DynamicString,
      href: CommonSchemas.DynamicString,
    }),
  },
  ({ props }) => (
    <li className="min-w-0 border-b border-border pb-4 [overflow-wrap:anywhere]">
      <ProductImage key={props.image} src={props.image} name={props.name} />
      <h3 className="mt-2 font-medium">
        <Link
          to={props.href}
          className="rounded underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {props.name}
        </Link>
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {props.description}
      </p>
      <p className="mt-2 text-sm text-primary">{props.price}</p>
    </li>
  ),
);

const ProductFocus = createComponentImplementation(
  {
    name: "ProductFocus",
    schema: z.object({
      title: CommonSchemas.DynamicString,
      description: CommonSchemas.DynamicString,
      selectedTitle: CommonSchemas.DynamicString,
      selectedDescription: CommonSchemas.DynamicString,
      active: CommonSchemas.DynamicBoolean,
      ready: CommonSchemas.DynamicBoolean,
      price: CommonSchemas.DynamicString,
      sku: CommonSchemas.DynamicString,
      compatibility: CommonSchemas.DynamicString,
      images: CommonSchemas.ChildList,
      retryVisible: CommonSchemas.DynamicBoolean,
      retry: CommonSchemas.Action,
    }),
  },
  ({ props, buildChild }) => (
    <section aria-labelledby="focus-title" className="[overflow-wrap:anywhere]">
      <p className="text-[10px] font-semibold leading-normal tracking-[0.14em] text-muted-foreground">
        YOUR NEXT RACE-DAY PROJECT
      </p>
      <h1
        id="focus-title"
        tabIndex={-1}
        className="mt-2.25 mb-6 font-display text-[clamp(38px,4vw,56px)] font-semibold leading-[1.1]"
      >
        {props.active ? props.selectedTitle : props.title}
      </h1>
      {props.active ? (
        <div aria-live="polite">
          {props.ready ? (
            <>
              {props.images.length ? (
                props.images.map((child) =>
                  buildChild(...childReference(child)),
                )
              ) : (
                <ProductImage src="" name="" />
              )}
              <p className="my-4 text-xl text-primary">{props.price}</p>
              <p className="my-3 whitespace-pre-wrap">
                {props.selectedDescription}
              </p>
              <p className="text-sm text-muted-foreground">SKU: {props.sku}</p>
              {props.compatibility ? (
                <p className="my-3 whitespace-pre-wrap">
                  {props.compatibility}
                </p>
              ) : null}
            </>
          ) : null}
          {props.retryVisible ? (
            <Button onClick={props.retry}>Retry product</Button>
          ) : null}
          <Link
            className="mt-4 block underline focus-visible:outline-2 focus-visible:outline-ring"
            to="/"
          >
            Back to Shop all
          </Link>
        </div>
      ) : (
        <>
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
        </>
      )}
    </section>
  ),
);

const Configuration = createComponentImplementation(
  {
    name: "Configuration",
    schema: z.object({
      productId: CommonSchemas.DynamicNumber,
      material: CommonSchemas.DynamicString,
      ready: CommonSchemas.DynamicBoolean,
      colorsReady: CommonSchemas.DynamicBoolean,
      colors: CommonSchemas.ChildList,
      color: CommonSchemas.DynamicString,
      quantity: CommonSchemas.DynamicString,
      quantityError: CommonSchemas.DynamicString,
      addDisabled: CommonSchemas.DynamicBoolean,
      colorStatus: CommonSchemas.DynamicString,
      bagStatus: CommonSchemas.DynamicString,
      retryVisible: CommonSchemas.DynamicBoolean,
      retry: CommonSchemas.Action,
    }),
  },
  ({ props, buildChild, context }) => (
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
        {props.ready ? `Material: ${props.material}` : "No part selected"}
      </p>
      <p className="text-[13px] leading-[1.6] text-muted-foreground">
        <span aria-live="polite">{props.colorStatus}</span>
      </p>
      {props.retryVisible ? (
        <Button onClick={props.retry}>Retry colors</Button>
      ) : null}
      <label className="mt-6 mb-2.25 block text-[12px]" htmlFor="color">
        Color
      </label>
      {props.ready ? (
        <select
          id="color"
          className="w-full min-w-0 rounded border border-input bg-background p-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
          value={props.color}
          disabled={!props.colorsReady}
          onChange={(event) =>
            void context.dispatchAction({
              event: {
                name: "configure",
                context: {
                  productId: props.productId,
                  color: event.target.value,
                },
              },
            })
          }
        >
          <option value="">Choose a color</option>
          {props.colors.map((child) => buildChild(...childReference(child)))}
        </select>
      ) : (
        <Input
          className="text-[12px]"
          id="color"
          placeholder="Choose a product first"
          disabled
        />
      )}
      <label className="mt-6 mb-2.25 block text-[12px]" htmlFor="quantity">
        Quantity
      </label>
      <Input
        className="text-[12px]"
        id="quantity"
        type="number"
        min={1}
        max={69}
        step={1}
        value={props.quantity}
        aria-invalid={Boolean(props.quantityError)}
        aria-describedby="quantity-error"
        onChange={(event) =>
          void context.dispatchAction({
            event: {
              name: "configure",
              context: {
                productId: props.productId,
                quantity: event.target.value,
              },
            },
          })
        }
        disabled={!props.ready}
      />
      <p id="quantity-error" aria-live="polite" className="mt-2 text-sm">
        {props.quantityError}
      </p>
      <Button
        className="mt-7 mb-2.5 w-full justify-between"
        disabled={props.addDisabled}
        onClick={() =>
          void context.dispatchAction({
            event: {
              name: "add-to-bag",
              context: { productId: props.productId },
            },
          })
        }
      >
        Add to bag <span aria-hidden="true">↗</span>
      </Button>
      <p className="text-center text-[11px] leading-[1.6] text-muted-foreground">
        Review your bag before checkout.
      </p>
      <p
        role="status"
        aria-label="Bag update"
        className="mt-3 text-center text-xs text-muted-foreground"
      >
        {props.bagStatus}
      </p>
      <Dialog.Trigger asChild>
        <Button variant="outline" className="mt-3 w-full">
          View your bag ↗
        </Button>
      </Dialog.Trigger>
    </section>
  ),
);

const ColorOption = createComponentImplementation(
  {
    name: "ColorOption",
    schema: z.object({
      value: CommonSchemas.DynamicString,
      label: CommonSchemas.DynamicString,
    }),
  },
  ({ props }) => <option value={props.value}>{props.label}</option>,
);
const DetailImage = createComponentImplementation(
  {
    name: "DetailImage",
    schema: z.object({
      src: CommonSchemas.DynamicString,
      name: CommonSchemas.DynamicString,
    }),
  },
  ({ props }) => (
    <ProductImage key={props.src} src={props.src} name={props.name} />
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

const CartPanel = createComponentImplementation(
  {
    name: "CartPanel",
    schema: z.object({
      lines: CommonSchemas.ChildList,
      status: CommonSchemas.DynamicString,
      total: CommonSchemas.DynamicString,
      busy: CommonSchemas.DynamicBoolean,
      uncertain: CommonSchemas.DynamicBoolean,
    }),
  },
  ({ props, buildChild, context }) => (
    <DialogContent
      title="Your bag"
      description="Your selected parts, ready for a final check."
    >
      <section id="bag" tabIndex={-1} aria-label="Your bag">
        <p role="status" aria-label="Bag status" className="my-3 text-sm">
          {props.status}
        </p>
        {props.status === "Your bag is empty." ? (
          <div className="px-4 py-7 text-center">
            <h3 className="font-display text-[27px] font-semibold">
              Your bag is ready for a project.
            </h3>
            <p className="mt-3 text-sm text-muted-foreground">
              Explore RC parts and pit tools to get started.
            </p>
          </div>
        ) : null}
        <ul className="space-y-4">
          {props.lines.map((child) => buildChild(...childReference(child)))}
        </ul>
        <dl className="my-5 space-y-3 border-t border-border pt-5">
          <div className="flex items-center justify-between gap-4">
            <dt>Subtotal</dt>
            <dd className="font-display text-2xl font-semibold">
              {props.total}
            </dd>
          </div>
          <div className="flex justify-between gap-4 text-sm text-muted-foreground">
            <dt>Shipping</dt>
            <dd className="text-right">Calculated at checkout</dd>
          </div>
        </dl>
        <Button
          variant="outline"
          disabled={props.busy}
          onClick={() =>
            void context.dispatchAction({ event: { name: "refresh-bag" } })
          }
        >
          Refresh bag
        </Button>
        {props.uncertain ? (
          <div className="mt-3">
            <p className="mb-2 text-sm">
              The last change may still complete. Refresh and check the
              quantities before making another change.
            </p>
            <Button
              disabled={props.busy}
              onClick={() =>
                void context.dispatchAction({
                  event: { name: "acknowledge-bag" },
                })
              }
            >
              I checked my bag
            </Button>
          </div>
        ) : null}
        <Dialog.Close asChild>
          <Button className="mt-5 w-full">Continue shopping</Button>
        </Dialog.Close>
      </section>
    </DialogContent>
  ),
);
const CartLine = createComponentImplementation(
  {
    name: "CartLine",
    schema: z.object({
      itemId: CommonSchemas.DynamicNumber,
      name: CommonSchemas.DynamicString,
      description: CommonSchemas.DynamicString,
      quantity: CommonSchemas.DynamicNumber,
      price: CommonSchemas.DynamicString,
      disabled: CommonSchemas.DynamicBoolean,
      unavailable: CommonSchemas.DynamicBoolean,
    }),
  },
  ({ props, context }) => (
    <li className="border-b border-border pb-4">
      <h3 className="font-semibold">{props.name}</h3>
      <p className="text-sm text-muted-foreground">{props.description}</p>
      <p>
        {props.price} · Quantity: {props.quantity}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          variant="outline"
          aria-label={`Decrease ${props.name} quantity`}
          disabled={props.disabled || props.unavailable || props.quantity <= 1}
          onClick={() =>
            void context.dispatchAction({
              event: {
                name: "change-bag",
                context: {
                  kind: "update",
                  itemId: props.itemId,
                  quantity: props.quantity - 1,
                },
              },
            })
          }
        >
          −
        </Button>
        <Button
          variant="outline"
          aria-label={`Increase ${props.name} quantity`}
          disabled={props.disabled || props.unavailable || props.quantity >= 69}
          onClick={() =>
            void context.dispatchAction({
              event: {
                name: "change-bag",
                context: {
                  kind: "update",
                  itemId: props.itemId,
                  quantity: props.quantity + 1,
                },
              },
            })
          }
        >
          +
        </Button>
        <Button
          variant="outline"
          aria-label={`Remove ${props.name}`}
          disabled={props.disabled}
          onClick={() =>
            void context.dispatchAction({
              event: {
                name: "change-bag",
                context: { kind: "remove", itemId: props.itemId },
              },
            })
          }
        >
          Remove
        </Button>
      </div>
    </li>
  ),
);

export const componentCatalog = new Catalog(
  "https://luluspeedworks.com/catalog/scaffold/v1",
  [
    PitBench,
    BrandHeader,
    ProductRail,
    CategoryControl,
    ProductEntry,
    ProductFocus,
    Configuration,
    ShoppingComposer,
    ColorOption,
    DetailImage,
    CartPanel,
    CartLine,
  ],
);
