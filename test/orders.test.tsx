import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { OrdersPanel } from "../src/storefront/orders";
import { order, orderPage } from "./order-fixtures";
import { renderWithClient, testClient } from "./query-client";

beforeEach(() => {
  window.history.replaceState(null, "", "/orders");
  vi.mocked(fetch).mockResolvedValue(Response.json(orderPage));
});

it("reads authenticated history, paginates using the server count and opens permanent detail links", async () => {
  const ten = Array.from({ length: 10 }, (_, i) => ({
    ...order,
    id: i + 1,
    orderNumber: `LULU-${i + 1}`,
  }));
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    expect(init?.credentials).toBe("include");
    expect(init?.cache).toBe("no-store");
    const request = new URL(String(url));
    if (request.pathname === "/orders/1") return Response.json(order);
    expect(request.searchParams.get("limit")).toBe("10");
    expect(request.searchParams.get("direction")).toBe("desc");
    const offset = Number(request.searchParams.get("offset"));
    return Response.json({
      orders:
        offset === 0 ? ten : [{ ...order, id: 11, orderNumber: "LULU-11" }],
      pagination: { offset, limit: 10, count: 11 },
    });
  });
  renderWithClient(<OrdersPanel userId="alice" />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading your orders");
  await screen.findByRole("link", { name: "Order LULU-1" });
  expect(
    screen.getByRole("button", { name: "Previous orders" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Next orders" }));
  await screen.findByRole("link", { name: "Order LULU-11" });
  expect(location.search).toBe("?offset=10");
  expect(screen.queryByRole("link", { name: "Order LULU-1" })).toBeNull();
  expect(screen.getByRole("button", { name: "Next orders" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Previous orders" }));
  fireEvent.click(await screen.findByRole("link", { name: "Order LULU-1" }));
  await screen.findByRole("heading", { name: "Order LULU-001" });
  expect(location.pathname).toBe("/orders/1");
  expect(screen.getByText("$32.99")).toBeVisible();
  expect(screen.getByText(/2 × RC stand/)).toBeVisible();
  expect(screen.getByRole("link", { name: "Track shipment" })).toHaveAttribute(
    "href",
    order.fulfillment.trackingUrl,
  );
  expect(screen.getByText(/Payment status unavailable/)).toBeVisible();
  fireEvent.click(screen.getByRole("link", { name: "Back to orders" }));
  await screen.findByRole("heading", { name: "Your orders" });
});

it.each(["-1", "bad", "999999999999999999999"])(
  "normalizes invalid pagination %s",
  async (offset) => {
    window.history.replaceState(null, "", `/orders?offset=${offset}`);
    renderWithClient(<OrdersPanel userId="alice" />);
    await screen.findByRole("link", { name: "Order LULU-001" });
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain("offset=0");
  },
);

it("shows an empty page and never fabricates order data", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      orders: [],
      pagination: { limit: 10, offset: 0, count: 0 },
    }),
  );
  renderWithClient(<OrdersPanel userId="alice" />);
  await screen.findByText("No orders on this page.");
  expect(screen.getByRole("button", { name: "Next orders" })).toBeDisabled();
});

it.each([401, 403, 404, 503])(
  "hides private content on HTTP %s and permits retry",
  async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: "Unavailable" }, { status }),
    );
    renderWithClient(<OrdersPanel userId="alice" />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("link", { name: "Order LULU-001" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry orders" }));
    await screen.findByRole("link", { name: "Order LULU-001" });
  },
);

it.each(["abc", "0", "999999999999999999999"])(
  "rejects invalid detail ID %s before fetching",
  async (id) => {
    window.history.replaceState(null, "", `/orders/${id}`);
    renderWithClient(<OrdersPanel userId="alice" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid order link");
    expect(fetch).not.toHaveBeenCalled();
  },
);

it.each([
  { ...orderPage, pagination: { limit: 10, offset: 1, count: 1 } },
  { ...orderPage, pagination: { limit: 10, offset: 0, count: 5 } },
  { ...orderPage, orders: [{ ...order, totalAmountCents: -1 }] },
  null,
])("rejects malformed or inconsistent order pages", async (response) => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(response));
  renderWithClient(<OrdersPanel userId="alice" />);
  await screen.findByRole("alert");
  expect(screen.queryByText("$32.99")).toBeNull();
});

it("rejects a detail response for a different requested order", async () => {
  window.history.replaceState(null, "", "/orders/2");
  vi.mocked(fetch).mockResolvedValue(Response.json(order));
  renderWithClient(<OrdersPanel userId="alice" />);
  await screen.findByRole("alert");
  expect(screen.queryByText("Order LULU-001")).toBeNull();
});

it("renders unknown fields honestly and rejects unsafe tracking URLs", async () => {
  window.history.replaceState(null, "", "/orders/1");
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      ...order,
      createdAt: null,
      status: null,
      slantStatus: null,
      totalAmountCents: null,
      items: [{ name: null, quantity: 1, color: null, filamentType: null }],
      fulfillment: {
        trackingNumber: null,
        trackingUrl: "javascript:alert(1)",
        carrier: null,
        estimatedArrival: null,
        shippedAt: null,
        deliveredAt: null,
      },
      cancellation: { canceledAt: null },
      internalSecret: "DO-NOT-DISPLAY",
    }),
  );
  renderWithClient(<OrdersPanel userId="alice" />);
  await screen.findByText("Total unavailable");
  expect(screen.getByText(/Item unavailable/)).toBeVisible();
  expect(screen.getByText(/Refund status unavailable/)).toBeVisible();
  expect(screen.queryByRole("link", { name: "Track shipment" })).toBeNull();
  expect(screen.queryByText("DO-NOT-DISPLAY")).toBeNull();
});

it("does not assume a currency or refund from a cancellation date", async () => {
  window.history.replaceState(null, "", "/orders/1");
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      ...order,
      currency: null,
      cancellation: { canceledAt: "2026-09-21" },
    }),
  );
  renderWithClient(<OrdersPanel userId="alice" />);
  await screen.findByText("Total unavailable");
  expect(
    screen.getByText(/Cancellation recorded: 2026-09-21/),
  ).toHaveTextContent("Refund status unavailable");
});

it("scopes history to the account and hides cached content while refreshing", async () => {
  const client = testClient();
  const view = renderWithClient(<OrdersPanel userId="alice" />, client);
  await screen.findByRole("link", { name: "Order LULU-001" });
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  void client.invalidateQueries({ queryKey: ["orders"] });
  await waitFor(() =>
    expect(screen.queryByRole("link", { name: "Order LULU-001" })).toBeNull(),
  );
  expect(screen.getByRole("status")).toBeVisible();
  view.rerender(<OrdersPanel userId="bob" />);
  expect(screen.queryByText("$32.99")).toBeNull();
});

it("shows unavailable local status in the list", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ ...orderPage, orders: [{ ...order, status: null }] }),
  );
  renderWithClient(<OrdersPanel userId="alice" />);
  await screen.findByText("Order status: Unavailable");
});
