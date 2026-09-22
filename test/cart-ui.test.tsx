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
vi.mock("../src/storefront/auth", async (original) => {
  const actual = await original<typeof import("../src/storefront/auth")>();
  return {
    ...actual,
    authClient: { $fetch: actual.authClient.$fetch, useSession: () => session },
  };
});

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
    if (path === "/profile")
      return Response.json({
        id: "alice",
        email: "alice@example.com",
        firstName: "Alice",
        lastName: "Driver",
        address: "123 Example Avenue",
        city: "Portland",
        state: "OR",
        zipCode: "97201",
        country: "US",
        phone: "5035550100",
      });
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
    if (path === `/cart/${cartId}/claim`)
      return Response.json({ message: "Cart claimed" });
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

it("refreshes the shared bag after restoring a guest cart from the account dialog", async () => {
  session.data = { user: { id: "alice", email: "alice@example.com" } };
  window.history.replaceState(null, "", "/profile");
  server = { items: [line], total: 2.29 };
  save();
  renderWithClient(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Restore this bag" }),
  );
  await screen.findByText("Your bag is restored.");
  expect(screen.queryByRole("button", { name: "Restore this bag" })).toBeNull();
  await waitFor(() => {
    const reads = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith(`/cart/${cartId}`) && init?.method === "GET",
      );
    expect(reads.length).toBeGreaterThan(0);
    expect(new Headers(reads.at(-1)?.[1]?.headers).has("X-Cart-Token")).toBe(
      false,
    );
  });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(await screen.findByRole("button", { name: "Bag (1)" }));
  expect(
    await within(screen.getByRole("dialog", { name: "Your bag" })).findByText(
      "$2.29",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Increase Part 1 quantity" }),
  ).toBeEnabled();
});
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

it("keeps account and bag out of the bench and opens them in prototype dialogs", async () => {
  session.data = { user: { id: "alice", email: "alice@example.com" } };
  window.history.replaceState(null, "", "/products/1");
  renderWithClient(<App />);
  await screen.findByRole("option", { name: "red — Red PLA" });
  fireEvent.change(screen.getByLabelText("Color"), {
    target: { value: color.publicId },
  });
  expect(screen.queryByRole("region", { name: "Account" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Your bag" })).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Account" }));
  await screen.findByRole("region", { name: "Account" });
  expect(location.pathname).toBe("/profile");
  expect(screen.getByRole("dialog", { name: "Your account" })).toBeVisible();
  const account = within(screen.getByRole("dialog", { name: "Your account" }));
  expect(await account.findByLabelText("First name")).toHaveValue("Alice");
  expect(account.getByRole("form", { name: "Shipping profile" })).toBeVisible();
  expect(
    within(screen.getByRole("dialog")).queryByText("THE PARTS DRAWER"),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByRole("region", { name: "MAKE IT YOURS" })).toBeVisible();
  expect(screen.getByLabelText("Color")).toHaveValue(color.publicId);
  fireEvent.click(screen.getByRole("button", { name: "Bag (0)" }));
  await screen.findByRole("region", { name: "Your bag" });
  expect(screen.getByRole("dialog", { name: "Your bag" })).toBeVisible();
  expect(location.pathname).toBe("/products/1");
  expect(screen.queryByRole("region", { name: "Account" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Continue shopping" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

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
  fireEvent.click(screen.getByRole("button", { name: /^Bag \(/ }));
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
  await screen.findByRole("option", { name: "red — Red PLA" });
  fireEvent.change(screen.getByLabelText("Color"), {
    target: { value: color.publicId },
  });
  const add = screen.getByRole("button", { name: /Add to bag/ });
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
  fireEvent.click(screen.getByRole("button", { name: /View your bag/ }));
  const bag = within(screen.getByRole("region", { name: "Your bag" }));
  await bag.findByText("$2.29");
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

it("passes selected configuration to the cart once without replaying on navigation", async () => {
  window.history.replaceState(null, "", "/products/1");
  renderWithClient(<App />);
  await screen.findByRole("option", { name: "red — Red PLA" });
  fireEvent.change(screen.getByLabelText("Color"), {
    target: { value: color.publicId },
  });
  fireEvent.change(screen.getByLabelText("Quantity"), {
    target: { value: "3" },
  });
  const add = screen.getByRole("button", { name: /Add to bag/ });
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
  fireEvent.click(screen.getByRole("button", { name: /View your bag/ }));
  await screen.findByText("$2.29 · Quantity: 3");
  await ready();
  const writes = () =>
    vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST");
  expect(writes().map(([url]) => new URL(String(url)).pathname)).toEqual([
    "/cart/create",
    "/cart/add",
  ]);
  const request = writes().find(([url]) => String(url).endsWith("/cart/add"));
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({
    cartId,
    skuNumber: "SKU-101",
    filamentId: color.publicId,
    color: "red",
    filamentType: "PLA",
    quantity: 3,
  });
  const count = writes().length;
  fireEvent.click(screen.getByRole("button", { name: "Continue shopping" }));
  fireEvent.click(screen.getByRole("link", { name: "Back to Shop all" }));
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await screen.findByRole("option", { name: "red — Red PLA" });
  expect(screen.getByLabelText("Color")).toHaveValue(color.publicId);
  expect(screen.getByLabelText("Quantity")).toHaveValue(3);
  await act(async () => {
    window.history.forward();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await screen.findByRole("heading", { level: 1, name: "Your bench awaits." });
  expect(writes()).toHaveLength(count);
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
  fireEvent.click(screen.getByRole("button", { name: /^Bag \(/ }));
  await screen.findByRole("status", { name: "Bag status" });
  await waitFor(() =>
    expect(
      screen.getByRole("status", { name: "Bag status" }),
    ).toHaveTextContent("A previous change has an unknown outcome."),
  );
  expect(screen.getByText("Unavailable item (SKU-101)")).toBeVisible();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "I checked my bag" }));
  const dialog = within(screen.getByRole("dialog", { name: "Your bag" }));
  await dialog.findByText("Bag updated.");
  const increases = screen.getAllByRole("button", { name: /Increase/ });
  for (const button of increases) expect(button).toBeDisabled();
  failWrite = true;
  const remove = screen.getAllByRole("button", { name: /Remove/ })[0];
  if (!remove) throw Error("Expected a remove button");
  fireEvent.click(remove);
  await dialog.findByText("Connection lost");
  fireEvent.click(screen.getByRole("button", { name: "Refresh bag" }));
  await dialog.findByText("A previous change has an unknown outcome.");
  failRead = true;
  refreshFromAnotherTab();
  await dialog.findByText(
    "Bag unavailable. Refresh to recover your saved bag.",
  );
  expect(screen.queryByText("Unavailable item (SKU-101)")).toBeNull();
});

it("rejects forged cart and stale product actions, including actions delivered while recovering", async () => {
  window.history.replaceState(null, "", "/products/1");
  const dispatch = vi.spyOn(SurfaceModel.prototype, "dispatchAction");
  renderWithClient(<App />);
  await screen.findByRole("option", { name: "red — Red PLA" });
  fireEvent.change(screen.getByLabelText("Quantity"), {
    target: { value: "2" },
  });
  const surface = dispatch.mock.instances[0];
  if (!(surface instanceof SurfaceModel)) throw Error("Expected A2UI surface");
  const activeSurface = surface;
  fireEvent.click(screen.getByRole("button", { name: /^Bag \(/ }));
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
