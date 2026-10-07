import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { AgentEffect } from "../src/storefront/agent-commerce";
import { agentFixture } from "./agent-fixtures";
import { apiPage, categories, product } from "./catalog-fixtures";
import { renderWithClient } from "./query-client";

const session = vi.hoisted(() => ({
  data: { user: { id: "alice" } } as { user: { id: string } } | null,
  isPending: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));
vi.mock("../src/storefront/auth", async (original) => {
  const actual = await original<typeof import("../src/storefront/auth")>();
  return {
    ...actual,
    authClient: { ...actual.authClient, useSession: () => session },
  };
});
const origin = "https://api.luluspeedworks.com";
const cartId = "11111111-1111-4111-8111-111111111111";
const colorId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const quoteId = "44444444-4444-4444-8444-444444444444";
let effect: AgentEffect;
let responseHook: (() => Promise<void>) | undefined;
const color = {
  publicId: colorId,
  name: "Red PLA",
  color: "red",
  profile: "PLA",
  available: true,
};
const selection: AgentEffect = {
  status: "selected",
  selection: {
    productId: 1,
    quantity: 2,
    filamentId: colorId,
    material: "PLA",
    color: "red",
  },
};
const review: AgentEffect = {
  kind: "checkout_review",
  accountId: "alice",
  status: "review_required",
  review: {
    quoteId,
    cartId,
    currency: "USD",
    subtotalCents: 200,
    shippingCents: 100,
    totalCents: 300,
    expiresAt: 9e12,
    confirmationRequired: true,
  },
};
const order = {
  id: 1,
  orderNumber: "Order 1",
  paymentStatus: "paid",
  fulfillmentState: "ready",
  status: "paid",
  totalAmountCents: 300,
  currency: "USD",
  shippedAt: null,
  deliveredAt: null,
  refund: null,
};
const orders: AgentEffect = {
  kind: "owned_orders",
  accountId: "alice",
  status: "known",
  orders: [order],
  policy: "unknown",
};
function ask() {
  fireEvent.change(
    screen.getByRole("textbox", { name: "YOUR SHOPPING REQUEST" }),
    { target: { value: "make it red" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Send shopping request" }),
  );
}
beforeEach(() => {
  localStorage.clear();
  session.data = { user: { id: "alice" } };
  session.isPending = false;
  session.error = null;
  responseHook = undefined;
  effect = selection;
  window.history.replaceState(null, "", "/products/1");
  localStorage.setItem(
    `lulu-cart-v2:${origin}`,
    JSON.stringify({
      cartId,
      ownerId: "alice",
      pending: false,
      revision: quoteId,
    }),
  );
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (_key: string, work: () => Promise<unknown>) => work(),
    },
  });
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/categories") return Response.json(categories);
    if (path === "/products") return Response.json(apiPage([1]));
    if (path === "/product/1")
      return Response.json({
        ...product(),
        skuNumber: "SKU-1",
        filamentType: "PLA",
        categories,
      });
    if (path === "/v2/colors")
      return Response.json({ success: true, data: [color] });
    if (path === "/agent/sessions")
      return Response.json({
        sessionId,
        capability: "visit",
        expiresAt: 9e12,
        absoluteExpiresAt: 9e12,
      });
    if (path.endsWith("/cancel")) return Response.json({});
    if (path.endsWith("/agent-state"))
      return Response.json({ cartId, revision: 0, items: [] });
    if (path === `/cart/${cartId}`)
      return Response.json({ items: [], total: 0 });
    if (path.startsWith("/orders"))
      return Response.json({
        accountId: "alice",
        orders: [],
        pagination: { limit: 20, offset: 0, count: 0 },
      });
    if (path.endsWith("/runs")) {
      const { runId, uiRevision } = JSON.parse(String(init?.body));
      if (responseHook) await responseHook();
      const events = [
        {
          type: "RUN_STARTED",
          threadId: sessionId,
          runId,
          metadata: { uiRevision },
        },
        {
          type: "CUSTOM",
          name: "lulu.progress.v1",
          value: { runId, uiRevision, stage: "admission", invocation: 0 },
        },
        {
          type: "CUSTOM",
          name: "kind" in effect ? "lulu.commerce.v1" : "lulu.cart.v1",
          value: { runId, uiRevision, result: effect },
        },
        {
          type: "CUSTOM",
          name: "lulu.a2ui.v1",
          value: { ...agentFixture, runId, uiRevision },
        },
        {
          type: "RUN_FINISHED",
          threadId: sessionId,
          runId,
          result: { uiRevision, status: "completed" },
        },
      ];
      return new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    }
    return Response.json({}, { status: 404 });
  });
});
afterEach(() => Reflect.deleteProperty(navigator, "locks"));
it("uses a validated selected event to change existing deterministic product controls", async () => {
  renderWithClient(<App />);
  await screen.findByRole("option", { name: "red — Red PLA" });
  fireEvent.change(screen.getByLabelText("Color"), {
    target: { value: colorId },
  });
  ask();
  await waitFor(() =>
    expect(screen.getByLabelText("Color")).toHaveValue(colorId),
  );
  expect(screen.getByLabelText("Quantity")).toHaveValue(2);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) => String(url).includes("/cart/add")),
  ).toBe(false);
});
it.each(["product", "material", "filament"])(
  "rejects an invalid %s selection without mutating the cart",
  async (invalid) => {
    effect = {
      ...selection,
      selection: {
        ...selection.selection,
        productId: invalid === "product" ? 2 : 1,
        material: invalid === "material" ? "PETG" : "PLA",
        filamentId: invalid === "filament" ? cartId : colorId,
      },
    };
    renderWithClient(<App />);
    await screen.findByRole("option", { name: "red — Red PLA" });
    ask();
    await screen.findByText(/Shopping guidance is unavailable/);
    expect(screen.getByLabelText("Color")).toHaveValue("");
  },
);
it.each(["review", "orders", "single-order", "attempt", "stale-review"])(
  "routes %s through trusted existing screens without payment writes",
  async (kind) => {
    effect =
      kind === "review"
        ? review
        : kind === "stale-review"
          ? { ...review, status: "stale" }
          : kind === "attempt"
            ? {
                kind: "checkout_attempt",
                accountId: "alice",
                status: "unknown",
                attempt: null,
              }
            : kind === "orders"
              ? { ...orders, orders: [] }
              : orders;
    renderWithClient(<App />);
    await screen.findByRole("option", { name: "red — Red PLA" });
    ask();
    if (kind === "review" || kind === "attempt")
      await screen.findByRole("heading", {
        name: "Shipping and checkout review",
      });
    else if (kind === "orders" || kind === "single-order")
      await screen.findByRole("heading", { name: "Your orders" });
    else
      await waitFor(() => expect(screen.getByLabelText("Color")).toBeEnabled());
    expect(window.location.pathname).toBe(
      kind === "single-order"
        ? "/orders/1"
        : kind === "orders"
          ? "/orders"
          : kind === "stale-review"
            ? "/products/1"
            : "/checkout",
    );
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url, init]) =>
            init?.method === "POST" &&
            /checkout-attempt|\/checkout$/.test(String(url)),
        ),
    ).toBe(false);
  },
);
it("discards an old account's late agent reply before rendering private content", async () => {
  let release!: () => void;
  responseHook = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  effect = orders;
  const view = renderWithClient(<App />);
  await screen.findByRole("option", { name: "red — Red PLA" });
  ask();
  await waitFor(() => expect(release).toBeTypeOf("function"));
  session.data = { user: { id: "bob" } };
  view.rerender(<App />);
  await act(async () => release());
  expect(window.location.pathname).toBe("/products/1");
  expect(screen.queryByText("Order 1")).toBeNull();
});

it("waits for a verified account before creating an agent visit", async () => {
  session.isPending = true;
  renderWithClient(<App />);
  await screen.findByRole("option", { name: "red — Red PLA" });
  ask();
  await screen.findByText(/Wait for your session/);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) => String(url).includes("/agent/")),
  ).toBe(false);
});
it("refreshes applied cart effects without replacing product configuration", async () => {
  effect = {
    status: "applied",
    appliedRevision: 4,
    cart: { cartId, revision: 4, items: [] },
  };
  renderWithClient(<App />);
  await screen.findByRole("option", { name: "red — Red PLA" });
  ask();
  await waitFor(() => expect(screen.getByLabelText("Color")).toBeEnabled());
  expect(window.location.pathname).toBe("/products/1");
});
