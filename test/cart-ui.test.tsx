import { SurfaceModel } from "@a2ui/web_core/v0_9";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { CartSnapshot } from "../src/storefront/cart";
import { apiPage, categories, product } from "./catalog-fixtures";
import { renderWithClient } from "./query-client";

const session = vi.hoisted(() => ({
  data: null as { user: { id: string; email: string } } | null,
  isPending: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));
vi.mock("../src/storefront/auth", async (original) => ({
  ...(await original<typeof import("../src/storefront/auth")>()),
  authClient: { useSession: () => session },
}));

const cartId = "8cfbf30a-2995-486e-a1e8-8f7d41488f1e";
const color = {
  publicId: "76fe1f79-3f1e-43e4-b8f4-61159de5b93c",
  name: "Red PLA",
  color: "red",
  profile: "PLA",
  available: true,
};
const key = "lulu-cart-v2:https://api.benhalverson.dev";
const line = {
  id: 91,
  productId: "SKU-101",
  quantity: 1,
  color: "red",
  filamentType: "PLA",
  filamentId: color.publicId,
  name: "Part 1",
  price: 2.29,
};
let server: CartSnapshot;
let failRead: boolean;
let failWrite: boolean;
beforeEach(() => {
  session.data = null;
  session.isPending = false;
  session.error = null;
  localStorage.clear();
  server = { items: [], total: 0 };
  failRead = false;
  failWrite = false;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (_key: string, callback: () => Promise<CartSnapshot>) =>
        callback(),
    },
  });
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/auth/get-session") return Response.json(null);
    if (path === "/categories") return Response.json(categories);
    if (path === "/products") return Response.json(apiPage([1]));
    if (path === "/product/1")
      return Response.json({
        ...product(),
        skuNumber: "SKU-101",
        filamentType: "PLA",
        categories,
      });
    if (path === "/v2/colors")
      return Response.json({ success: true, data: [color] });
    if (path === "/cart/create")
      return Response.json({ cartId, guestToken: cartId });
    if (init?.method === "GET")
      return failRead
        ? Response.json({}, { status: 403 })
        : Response.json(server);
    if (failWrite) throw Error("Connection lost");
    const body = JSON.parse(String(init?.body));
    server.items =
      path === "/cart/remove" ? [] : [{ ...line, quantity: body.quantity }];
    server.total = server.items.length * body.quantity * 2.29 || 0;
    return Response.json({ message: "ok" });
  });
});
afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(navigator, "locks");
});
function save(pending = false) {
  localStorage.setItem(
    key,
    JSON.stringify({
      cartId,
      guestToken: cartId,
      ownerId: null,
      pending,
      revision: crypto.randomUUID(),
    }),
  );
}
function refreshFromAnotherTab(pending = false) {
  act(() => {
    save(pending);
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });
}
async function ready() {
  await waitFor(() =>
    expect(
      screen.getByRole("status", { name: "Bag status" }),
    ).not.toHaveTextContent("Updating"),
  );
}

it("removes private bag lines while a session is rechecking or changes account", async () => {
  session.data = { user: { id: "alice", email: "alice@example.com" } };
  localStorage.setItem(
    key,
    JSON.stringify({
      cartId,
      ownerId: "alice",
      pending: false,
      revision: crypto.randomUUID(),
    }),
  );
  server = { items: [line], total: 2.29 };
  const view = renderWithClient(<App />);
  await waitFor(() =>
    expect(screen.getByRole("region", { name: "Your bag" })).toHaveTextContent(
      "SKU-101",
    ),
  );
  session.isPending = true;
  view.rerender(<App />);
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "Your bag" }),
    ).not.toHaveTextContent("SKU-101"),
  );
  session.isPending = false;
  session.error = Error("Session unavailable");
  view.rerender(<App />);
  expect(
    screen.getByRole("region", { name: "Your bag" }),
  ).not.toHaveTextContent("SKU-101");
  session.error = null;
  session.data = { user: { id: "bob", email: "bob@example.com" } };
  view.rerender(<App />);
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "Your bag" }),
    ).not.toHaveTextContent("SKU-101"),
  );
});

it("uses real A2UI bindings for add, quantity changes, removal and explicit refresh", async () => {
  window.history.replaceState(null, "", "/products/1");
  renderWithClient(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByRole("option", { name: new RegExp(color.publicId) });
  fireEvent.change(screen.getByLabelText("Color"), {
    target: { value: color.publicId },
  });
  const add = screen.getByRole("button", { name: /Add to bag/ });
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
  const bag = within(screen.getByRole("region", { name: "Your bag" }));
  await bag.findByText(
    "Item subtotal: $2.29. Shipping calculated at checkout.",
  );
  await ready();
  expect(bag.getByRole("button", { name: /Decrease/ })).toBeDisabled();
  fireEvent.click(bag.getByRole("button", { name: /Increase/ }));
  await bag.findByText("$2.29 · Quantity: 2");
  await ready();
  fireEvent.click(bag.getByRole("button", { name: /Decrease/ }));
  await bag.findByText("$2.29 · Quantity: 1");
  await ready();
  fireEvent.click(bag.getByRole("button", { name: /Remove/ }));
  await bag.findByText("Your bag is empty.");
  fireEvent.click(bag.getByRole("button", { name: "Refresh bag" }));
  await ready();
});

it("renders unavailable lines, maximum quantity, unknown outcome recovery and read/write errors", async () => {
  server = {
    items: [
      { ...line, quantity: 69 },
      { ...line, id: 92, name: null, price: null },
      { ...line, id: 93, price: null },
    ],
    total: 158.01,
  };
  save(true);
  renderWithClient(<App />);
  await screen.findByText("A previous change has an unknown outcome.");
  expect(screen.getByText("Unavailable item (SKU-101)")).toBeVisible();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "I checked my bag" }));
  await screen.findByText("Bag updated.");
  const increases = screen.getAllByRole("button", { name: /Increase/ });
  for (const button of increases) expect(button).toBeDisabled();
  failWrite = true;
  const remove = screen.getAllByRole("button", { name: /Remove/ })[0];
  if (!remove) throw Error("Expected a remove button");
  fireEvent.click(remove);
  await screen.findByText("Connection lost");
  fireEvent.click(screen.getByRole("button", { name: "Refresh bag" }));
  await screen.findByText("A previous change has an unknown outcome.");
  failRead = true;
  refreshFromAnotherTab();
  await screen.findByText(
    "Bag unavailable. Refresh to recover your saved bag.",
  );
  expect(screen.queryByText("Unavailable item (SKU-101)")).toBeNull();
});

it("rejects forged cart and stale product actions, including actions delivered while recovering", async () => {
  window.history.replaceState(null, "", "/products/1");
  const dispatch = vi.spyOn(SurfaceModel.prototype, "dispatchAction");
  renderWithClient(<App />);
  await screen.findByRole("option", { name: new RegExp(color.publicId) });
  fireEvent.change(screen.getByLabelText("Quantity"), {
    target: { value: "2" },
  });
  const surface = dispatch.mock.instances[0];
  if (!(surface instanceof SurfaceModel)) throw Error("Expected A2UI surface");
  const activeSurface = surface;
  async function send(
    name: string,
    context: Record<string, string | number> = {},
  ) {
    await act(() =>
      activeSurface.dispatchAction(
        { event: { name, context } },
        "configuration",
      ),
    );
  }
  await ready();
  await send("add-to-bag");
  await send("add-to-bag", { productId: 2 });
  await send("add-to-bag", { productId: 1 });
  await send("change-bag");
  // A generated add cannot bypass the selected product/color checks.
  await act(() =>
    surface.dispatchAction(
      {
        event: {
          name: "change-bag",
          context: {
            kind: "add",
            item: {
              skuNumber: "SKU-101",
              quantity: 1,
              color: "red",
              filamentType: "PLA",
              filamentId: color.publicId,
            },
          },
        },
      },
      "configuration",
    ),
  );
  refreshFromAnotherTab(true);
  await ready();
  await send("change-bag", { kind: "remove", itemId: 91 });
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) => String(url).includes("/cart/add")),
  ).toBe(false);
});
