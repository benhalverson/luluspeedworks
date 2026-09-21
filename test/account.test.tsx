import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountPanel } from "../src/storefront/account";
import { authClient, authenticate } from "../src/storefront/auth";
import { renderWithClient, testClient } from "./query-client";

const session = vi.hoisted(() => ({
  data: null as { user: { id: string; email: string } } | null,
  isPending: false,
  error: null as Error | null,
  refetch: vi.fn(async () => {}),
}));
vi.mock("../src/storefront/auth", async (original) => {
  const actual = await original<typeof import("../src/storefront/auth")>();
  return {
    ...actual,
    authenticate: vi.fn(async () => ({
      id: "user-1",
      email: "ben@example.com",
    })),
    authClient: {
      $fetch: actual.authClient.$fetch,
      useSession: () => session,
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
});
beforeEach(() => {
  session.data = null;
  session.error = null;
  session.isPending = false;
  localStorage.clear();
  vi.mocked(authenticate).mockClear();
});
afterEach(() => Reflect.deleteProperty(navigator, "locks"));
async function fill(password = "test password") {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "ben@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
}
it("validates signup and uses React Hook Form without putting credentials in A2UI", async () => {
  window.history.replaceState(null, "", "/signup?returnTo=%2Fproducts%2F1");
  renderWithClient(<AccountPanel />);
  await fill("short");
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  await screen.findByText("Use at least 8 characters.");
  expect(authenticate).not.toHaveBeenCalled();
  await fill();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ben" } });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  await waitFor(() =>
    expect(authenticate).toHaveBeenCalledWith("signup", {
      name: "Ben",
      email: "ben@example.com",
      password: "test password",
    }),
  );
  await waitFor(() => expect(location.pathname).toBe("/products/1"));
});
it("preserves the guest cart on login and clears private query data", async () => {
  window.history.replaceState(null, "", "/signin?returnTo=%2Fcheckout");
  const key = "lulu-cart-v2:https://api.benhalverson.dev";
  const cartId = "8cfbf30a-2995-486e-a1e8-8f7d41488f1e";
  localStorage.setItem(
    key,
    JSON.stringify({
      cartId,
      guestToken: cartId,
      ownerId: null,
      pending: false,
      revision: crypto.randomUUID(),
    }),
  );
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (_key: string, callback: () => Promise<unknown>) =>
        callback(),
    },
  });
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).endsWith("/claim")) {
      expect(new Headers(init?.headers).get("X-Cart-Token")).toBe(cartId);
      return Response.json({ message: "Cart claimed" });
    }
    return Response.json({ items: [], total: 0 });
  });
  const client = testClient();
  client.setQueryData(["orders"], { private: true });
  renderWithClient(<AccountPanel />, client);
  await fill();
  fireEvent.click(
    screen.getByRole("button", { name: "Sign in with password" }),
  );
  await waitFor(() => expect(location.pathname).toBe("/checkout"));
  expect(JSON.parse(localStorage.getItem(key) ?? "null")).toMatchObject({
    cartId,
    ownerId: "user-1",
  });
  expect(
    JSON.parse(localStorage.getItem(key) ?? "null").guestToken,
  ).toBeUndefined();
  expect(client.getQueryData(["orders"])).toBeUndefined();
});
it("uses passkeys independently of password validation and shows cancellation failures", async () => {
  window.history.replaceState(null, "", "/signin");
  vi.mocked(authenticate).mockRejectedValueOnce(Error("Passkey was cancelled"));
  renderWithClient(<AccountPanel />);
  fireEvent.click(
    screen.getByRole("button", { name: "Sign in with a passkey" }),
  );
  await screen.findByText("Passkey was cancelled");
  expect(authenticate).toHaveBeenCalledWith("passkey", {
    name: "",
    email: "",
    password: "",
  });
  fireEvent.click(screen.getByRole("link", { name: "Create an account" }));
  await screen.findByLabelText("Name");
  expect(screen.queryByText("Passkey was cancelled")).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: /Already have/ }));
  expect(screen.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
it("clears browser cart capability on signout and reports signout failure", async () => {
  session.data = { user: { id: "user-1", email: "ben@example.com" } };
  const key = "lulu-cart-v2:https://api.benhalverson.dev";
  const cartId = "8cfbf30a-2995-486e-a1e8-8f7d41488f1e";
  localStorage.setItem(
    key,
    JSON.stringify({
      cartId,
      ownerId: "user-1",
      pending: false,
      revision: crypto.randomUUID(),
    }),
  );
  vi.mocked(authClient.signOut).mockResolvedValueOnce({
    data: null,
    error: {
      message: "Sign-out failed",
      status: 500,
      statusText: "Internal Server Error",
    },
  });
  renderWithClient(<AccountPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByText("Sign-out failed. Please try again.");
  expect(localStorage.getItem(key)).toContain(cartId);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
});
it("can retry an interrupted guest claim after the session is restored", async () => {
  session.data = { user: { id: "user-1", email: "ben@example.com" } };
  const cartId = "8cfbf30a-2995-486e-a1e8-8f7d41488f1e";
  const key = "lulu-cart-v2:https://api.benhalverson.dev";
  localStorage.setItem(
    key,
    JSON.stringify({
      cartId,
      guestToken: cartId,
      ownerId: "user-1",
      pending: false,
      revision: crypto.randomUUID(),
    }),
  );
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (_key: string, callback: () => Promise<unknown>) =>
        callback(),
    },
  });
  let failClaim = true;
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).endsWith("/claim"))
      return failClaim
        ? new Response(null, { status: 503 })
        : Response.json({ message: "claimed" });
    return Response.json({ items: [], total: 0 });
  });
  renderWithClient(<AccountPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Restore this bag" }));
  await screen.findByText(/Bag request failed \(503\)/);
  failClaim = false;
  fireEvent.click(screen.getByRole("button", { name: "Restore this bag" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Restore this bag" }),
    ).toBeNull(),
  );
  expect(
    JSON.parse(localStorage.getItem(key) ?? "null").guestToken,
  ).toBeUndefined();
});

it("opens the existing account's profile and removes its fields on expiry", async () => {
  window.history.replaceState(null, "", "/profile");
  session.data = { user: { id: "user-1", email: "ben@example.com" } };
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      id: "user-1",
      email: "ben@example.com",
      firstName: "Ben",
      lastName: "Driver",
      address: "123 Example Avenue",
      city: "Portland",
      state: "OR",
      zipCode: "97201",
      country: "US",
      phone: "5035550100",
    }),
  );
  const view = renderWithClient(<AccountPanel />);
  await screen.findByDisplayValue("Ben");
  session.data = null;
  view.rerender(<AccountPanel />);
  expect(screen.queryByLabelText("First name")).toBeNull();
  expect(
    screen.getByRole("link", { name: "Sign in or create an account" }),
  ).toHaveAttribute("href", "/signin?returnTo=%2Fprofile");
});

it("keeps browsing available while session lookup is pending or unavailable", () => {
  session.isPending = true;
  const view = renderWithClient(<AccountPanel />);
  expect(screen.getByText("Checking your session…")).toBeVisible();
  session.isPending = false;
  session.error = Error("Network unavailable");
  view.rerender(<AccountPanel />);
  expect(screen.getByText(/Session unavailable/)).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Sign in or create an account" }),
  ).toHaveAttribute("href", "/signin?returnTo=%2F");
});
