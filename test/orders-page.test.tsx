import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { order, orderPage } from "./order-fixtures";
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
    authClient: { $fetch: actual.authClient.$fetch, useSession: () => session },
  };
});
beforeEach(() => {
  session.data = { user: { id: "alice" } };
  session.isPending = false;
  session.error = null;
  session.refetch.mockReset();
  window.history.replaceState(null, "", "/orders");
  vi.mocked(fetch).mockResolvedValue(Response.json(orderPage));
});

it.each(["signout", "pending", "error", "account"])(
  "hides private orders immediately on %s",
  async (change) => {
    const view = renderWithClient(<App />);
    await screen.findByRole("link", { name: "Order LULU-001" });
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    if (change === "signout") session.data = null;
    if (change === "pending") session.isPending = true;
    if (change === "error") session.error = Error("denied");
    if (change === "account") session.data = { user: { id: "bob" } };
    view.rerender(<App />);
    expect(screen.queryByText("$32.99")).toBeNull();
    expect(screen.queryByRole("link", { name: "Order LULU-001" })).toBeNull();
    if (change !== "account")
      expect(
        screen.getByRole("link", { name: "Sign in to view your orders" }),
      ).toHaveAttribute("href", "/signin?returnTo=%2Forders");
  },
);

it("rejects obsolete account responses after the next account's orders load", async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const view = renderWithClient(<App />);
  await screen.findByText("Loading your orders…");
  session.data = { user: { id: "bob" } };
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      ...orderPage,
      orders: [{ ...order, orderNumber: "BOB-002" }],
    }),
  );
  view.rerender(<App />);
  await screen.findByRole("link", { name: "Order BOB-002" });
  await act(async () => finish(Response.json(orderPage)));
  expect(screen.queryByRole("link", { name: "Order LULU-001" })).toBeNull();
  expect(screen.getByRole("link", { name: "Order BOB-002" })).toBeVisible();
});

it("revalidates the session after protected order access expires and preserves the detail destination", async () => {
  window.history.replaceState(null, "", "/orders/1");
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ error: "Expired" }, { status: 401 }),
  );
  const view = renderWithClient(<App />);
  await waitFor(() => expect(session.refetch).toHaveBeenCalled());
  session.data = null;
  view.rerender(<App />);
  expect(
    screen.getByRole("link", { name: "Sign in to view your orders" }),
  ).toHaveAttribute("href", "/signin?returnTo=%2Forders%2F1");
  expect(screen.queryByText("$32.99")).toBeNull();
});

it("loads permanent order links and returns to authenticated history", async () => {
  window.history.replaceState(null, "", "/orders/1");
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(order));
  renderWithClient(<App />);
  await screen.findByRole("heading", { name: "Order LULU-001" });
  fireEvent.click(screen.getByRole("link", { name: "Back to orders" }));
  await screen.findByRole("link", { name: "Order LULU-001" });
});
