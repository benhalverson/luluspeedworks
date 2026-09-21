import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type CartSnapshot, cartSchema, useCart } from "../src/storefront/cart";
import { testClient } from "./query-client";

const origin = "https://cart.example.com";
const key = `lulu-cart-v2:${origin}`;
const cartId = "8cfbf30a-2995-486e-a1e8-8f7d41488f1e";
const filamentId = "76fe1f79-3f1e-43e4-b8f4-61159de5b93c";
const item = {
  skuNumber: "SKU-101",
  quantity: 2,
  color: "red",
  filamentType: "PLA" as const,
  filamentId,
};
const line = {
  id: 91,
  productId: item.skuNumber,
  quantity: 2,
  color: "red",
  filamentType: "PLA",
  filamentId,
  name: "Part",
  price: 2.29,
};
let server: CartSnapshot;
let requests: {
  path: string;
  method: string;
  body: Record<string, string | number>;
}[];
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
function mount(identity: string | null = null, ready = true) {
  const client = testClient();
  return renderHook((props) => useCart(origin, props.identity, props.ready), {
    initialProps: { identity, ready },
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
beforeEach(() => {
  localStorage.clear();
  server = { items: [], total: 0 };
  requests = [];
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: vi.fn(
        async (_name: string, callback: () => Promise<CartSnapshot>) =>
          callback(),
      ),
    },
  });
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? "GET";
    const body = JSON.parse(String(init?.body ?? "{}"));
    requests.push({ path, method, body });
    expect(init?.credentials).toBe("include");
    expect(init?.cache).toBe("no-store");
    if (path === "/cart/create")
      return Response.json({ cartId, guestToken: cartId });
    if (method === "GET") return Response.json(server);
    if (path === "/cart/add") {
      const current = server.items[0];
      server.items = [
        { ...line, quantity: (current?.quantity ?? 0) + body.quantity },
      ];
    } else if (path === "/cart/update")
      server.items = server.items.map((row) => ({
        ...row,
        quantity: body.quantity,
      }));
    else server.items = [];
    server.total = server.items.reduce(
      (total, row) => total + row.quantity * (row.price ?? 0),
      0,
    );
    return Response.json({ message: "ok" });
  });
});
afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(navigator, "locks");
});

it("creates once, uses SKU and server line IDs, reconciles totals and restores after remount", async () => {
  const first = mount();
  await waitFor(() => expect(first.result.current.cart.isSuccess).toBe(true));
  expect(fetch).not.toHaveBeenCalled();
  await act(() =>
    first.result.current.mutation.mutateAsync({ kind: "add", item }),
  );
  await waitFor(() => expect(first.result.current.cart.data?.total).toBe(4.58));
  expect(requests.find((r) => r.path === "/cart/add")?.body).toEqual({
    ...item,
    cartId,
  });
  first.unmount();
  const second = mount();
  await waitFor(() =>
    expect(second.result.current.cart.data?.items[0]?.id).toBe(91),
  );
  await act(() =>
    second.result.current.mutation.mutateAsync({
      kind: "update",
      itemId: 91,
      quantity: 3,
    }),
  );
  await waitFor(() =>
    expect(second.result.current.cart.data?.total).toBe(6.87),
  );
  expect(requests.find((r) => r.path === "/cart/update")).toMatchObject({
    method: "PUT",
    body: { cartId, itemId: 91, quantity: 3 },
  });
  await act(() =>
    second.result.current.mutation.mutateAsync({ kind: "remove", itemId: 91 }),
  );
  await waitFor(() =>
    expect(second.result.current.cart.data?.items).toEqual([]),
  );
  expect(requests.filter((r) => r.path === "/cart/create")).toHaveLength(1);
});

it("never automatically retries an ambiguous add and preserves its marker across reload", async () => {
  save();
  const view = mount();
  await waitFor(() => expect(view.result.current.cart.isSuccess).toBe(true));
  const original = vi.mocked(fetch).getMockImplementation();
  if (!original) throw new Error("Expected the cart fetch fixture");
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (new URL(String(url)).pathname === "/cart/add") {
      server = { items: [line], total: 4.58 };
      throw new Error("Connection lost after commit");
    }
    if (!original) throw Error("Missing mock");
    return original(url, init);
  });
  await act(async () => {
    await expect(
      view.result.current.mutation.mutateAsync({ kind: "add", item }),
    ).rejects.toThrow("Connection lost");
  });
  expect(view.result.current.uncertain).toBe(true);
  view.unmount();
  const again = mount();
  await waitFor(() =>
    expect(again.result.current.cart.data?.items).toEqual([line]),
  );
  await act(async () => {
    await expect(
      again.result.current.mutation.mutateAsync({ kind: "add", item }),
    ).rejects.toThrow("unknown outcome");
  });
  await act(() =>
    again.result.current.mutation.mutateAsync({ kind: "acknowledge" }),
  );
  expect(again.result.current.uncertain).toBe(false);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(
        ([url]) => new URL(String(url)).pathname === "/cart/add",
      ),
  ).toHaveLength(1);
});

it("serializes repeated adds and refuses quantity overflow or missing lines", async () => {
  save();
  server = { items: [line], total: 4.58 };
  const view = mount();
  await act(async () => {
    await Promise.all([
      view.result.current.mutation.mutateAsync({ kind: "add", item }),
      view.result.current.mutation.mutateAsync({ kind: "add", item }),
    ]);
  });
  expect(server.items[0]?.quantity).toBe(6);
  await act(async () => {
    await expect(
      view.result.current.mutation.mutateAsync({
        kind: "add",
        item: { ...item, quantity: 69 },
      }),
    ).rejects.toThrow("at most 69");
  });
  await act(async () => {
    await expect(
      view.result.current.mutation.mutateAsync({ kind: "remove", itemId: 123 }),
    ).rejects.toThrow("no longer");
  });
});

it("refreshes on cross-tab changes and tolerates unavailable product fields", async () => {
  save();
  const view = mount();
  await waitFor(() => expect(view.result.current.cart.data).toEqual(server));
  server = { items: [{ ...line, name: null, price: null }], total: 0 };
  act(() => {
    save();
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });
  await waitFor(() =>
    expect(view.result.current.cart.data?.items[0]?.name).toBeNull(),
  );
  act(() =>
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" })),
  );
  server = { items: [], total: 0 };
  act(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
  });
  await waitFor(() => expect(view.result.current.cart.data).toEqual(server));
});

it("fails closed for unsupported locks, absent carts, HTTP failure and corrupt responses", async () => {
  const view = mount();
  await act(() =>
    view.result.current.mutation.mutateAsync({ kind: "acknowledge" }),
  );
  await act(async () => {
    await expect(
      view.result.current.mutation.mutateAsync({ kind: "remove", itemId: 91 }),
    ).rejects.toThrow("no longer available");
  });
  Reflect.deleteProperty(navigator, "locks");
  await act(async () => {
    await expect(
      view.result.current.mutation.mutateAsync({ kind: "add", item }),
    ).rejects.toThrow("secure cross-tab locks");
  });
  save();
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ error: "Forbidden" }, { status: 403 }),
  );
  act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
  await waitFor(() =>
    expect(view.result.current.cart.error?.message).toContain("403"),
  );
  vi.mocked(fetch).mockImplementation(async () =>
    Response.json({ items: [line, line], total: 4.58 }),
  );
  await act(() => view.result.current.cart.refetch());
  expect(view.result.current.cart.isError).toBe(true);
  expect(cartSchema.safeParse({ items: [line], total: -1 }).success).toBe(
    false,
  );
});

it("claims with the guest capability and stops sending it once owned", async () => {
  save();
  const view = mount("alice");
  const original = vi.mocked(fetch).getMockImplementation();
  if (!original) throw new Error("Expected the cart fetch fixture");
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).endsWith("/claim")) {
      expect(new Headers(init?.headers).get("X-Cart-Token")).toBe(cartId);
      return Response.json({ message: "claimed" });
    }
    return original(url, init);
  });
  await waitFor(() => expect(view.result.current.claimable).toBe(true));
  await act(() =>
    view.result.current.mutation.mutateAsync({
      kind: "claim",
      userId: "alice",
    }),
  );
  const stored = JSON.parse(localStorage.getItem(key) ?? "null");
  expect(stored.ownerId).toBe("alice");
  expect(stored.guestToken).toBeUndefined();
  await act(() => view.result.current.cart.refetch());
  const last = vi.mocked(fetch).mock.calls.at(-1);
  expect(new Headers(last?.[1]?.headers).has("X-Cart-Token")).toBe(false);
  expect(view.result.current.claimable).toBe(false);
});

it("hides private data on session expiry, account switch, and pending session verification", async () => {
  localStorage.setItem(
    key,
    JSON.stringify({
      cartId,
      ownerId: "alice",
      pending: false,
      revision: crypto.randomUUID(),
    }),
  );
  server = { items: [line], total: 4.58 };
  const view = mount("alice");
  await waitFor(() =>
    expect(view.result.current.cart.data?.items).toHaveLength(1),
  );
  view.rerender({ identity: "alice", ready: false });
  expect(view.result.current.cart.data).toBeUndefined();
  await act(async () => {
    await expect(
      view.result.current.mutation.mutateAsync({ kind: "add", item }),
    ).rejects.toThrow("session");
  });
  view.rerender({ identity: null, ready: true });
  await waitFor(() =>
    expect(view.result.current.cart.data?.items).toHaveLength(0),
  );
  const reads = requests.length;
  view.rerender({ identity: "bob", ready: true });
  await waitFor(() =>
    expect(view.result.current.cart.data?.items).toHaveLength(0),
  );
  await act(() =>
    view.result.current.mutation.mutateAsync({ kind: "claim", userId: "bob" }),
  );
  expect(requests).toHaveLength(reads);
  expect(JSON.parse(localStorage.getItem(key) ?? "null").ownerId).toBe("alice");
});

it("retains an interrupted claim for its intended account and permits a safe retry", async () => {
  save();
  const view = mount("alice");
  let failClaim = true;
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).endsWith("/claim")) {
      if (failClaim) throw Error("Claim response lost");
      return Response.json({ message: "already owned" });
    }
    return Response.json(server);
  });
  await act(async () => {
    await expect(
      view.result.current.mutation.mutateAsync({
        kind: "claim",
        userId: "alice",
      }),
    ).rejects.toThrow("lost");
  });
  expect(JSON.parse(localStorage.getItem(key) ?? "null")).toMatchObject({
    ownerId: "alice",
    guestToken: cartId,
  });
  failClaim = false;
  await act(() =>
    view.result.current.mutation.mutateAsync({
      kind: "claim",
      userId: "alice",
    }),
  );
  expect(
    JSON.parse(localStorage.getItem(key) ?? "null").guestToken,
  ).toBeUndefined();
});

it("rechecks a claim after another tab clears the cart while waiting for the lock", async () => {
  save();
  const view = mount("alice");
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (_name: string, callback: () => Promise<CartSnapshot>) => {
        localStorage.removeItem(key);
        return callback();
      },
    },
  });
  await act(() =>
    view.result.current.mutation.mutateAsync({
      kind: "claim",
      userId: "alice",
    }),
  );
  expect(requests.every((request) => request.method === "GET")).toBe(true);
});

it("creates account-owned carts without requiring a guest token", async () => {
  const view = mount("alice");
  const original = vi.mocked(fetch).getMockImplementation();
  if (!original) throw new Error("Expected the cart fetch fixture");
  vi.mocked(fetch).mockImplementation(async (url, init) =>
    String(url).endsWith("/cart/create")
      ? Response.json({ cartId })
      : original(url, init),
  );
  await act(() =>
    view.result.current.mutation.mutateAsync({ kind: "add", item }),
  );
  expect(JSON.parse(localStorage.getItem(key) ?? "null")).toMatchObject({
    ownerId: "alice",
    cartId,
  });
});

it.each([true, false])(
  "does not send an item mutation when saving fails (existing cart: %s)",
  async (existing) => {
    if (existing) save();
    const view = mount();
    await waitFor(() => expect(view.result.current.cart.isSuccess).toBe(true));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw Error("Quota exceeded");
    });
    await act(async () => {
      await expect(
        view.result.current.mutation.mutateAsync({ kind: "add", item }),
      ).rejects.toThrow("storage unavailable");
    });
    expect(requests.some((r) => r.path === "/cart/add")).toBe(false);
  },
);
