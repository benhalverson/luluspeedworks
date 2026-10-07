import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Link } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountPanel } from "../src/storefront/account";
import { authClient, authenticate } from "../src/storefront/auth";
import { setBrowserOrigin } from "./browser-origin";
import { renderWithClient, testClient } from "./query-client";

const initialBrowserOrigin = window.location.origin;

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
it("links password recovery to the validated sign-in destination", () => {
  window.history.replaceState(null, "", "/signin?returnTo=%2Fproducts%2F12");
  renderWithClient(<AccountPanel />);
  expect(
    screen.getByRole("link", { name: "Forgot password?" }),
  ).toHaveAttribute("href", "/forgot-password?returnTo=%2Fproducts%2F12");
});
afterEach(() => {
  Reflect.deleteProperty(navigator, "locks");
  setBrowserOrigin(initialBrowserOrigin);
});
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
  const key = "lulu-cart-v2:https://api.luluspeedworks.com";
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
      return Response.json({ message: "Cart claimed", ownerId: "user-1" });
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

it("clears the failed login message when restoring the guest bag succeeds", async () => {
  window.history.replaceState(null, "", "/signin");
  const cartId = "8cfbf30a-2995-486e-a1e8-8f7d41488f1e";
  const key = "lulu-cart-v2:https://api.luluspeedworks.com";
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
  vi.mocked(fetch).mockImplementation(async (url) =>
    String(url).endsWith("/claim")
      ? Response.json({ message: "Cart claimed", ownerId: "user-1" })
      : Response.json({ items: [], total: 0 }),
  );
  vi.mocked(authenticate).mockRejectedValueOnce(
    Error("Wait for your session to finish loading."),
  );
  const view = renderWithClient(<AccountPanel />);
  await fill();
  fireEvent.click(
    screen.getByRole("button", { name: "Sign in with password" }),
  );
  await screen.findByText("Wait for your session to finish loading.");
  session.data = { user: { id: "user-1", email: "ben@example.com" } };
  view.rerender(<AccountPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Restore this bag" }));
  await waitFor(() =>
    expect(
      JSON.parse(localStorage.getItem(key) ?? "null").guestToken,
    ).toBeUndefined(),
  );
  expect(
    screen.queryByText("Wait for your session to finish loading."),
  ).toBeNull();
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Your bag is restored.",
  );
});

it("claims the guest bag after verified login even while the session hook refreshes", async () => {
  window.history.replaceState(null, "", "/signin?returnTo=%2Fproducts%2F1");
  const cartId = "8cfbf30a-2995-486e-a1e8-8f7d41488f1e";
  const key = "lulu-cart-v2:https://api.luluspeedworks.com";
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
  vi.mocked(fetch).mockImplementation(async (url) =>
    String(url).endsWith("/claim")
      ? Response.json({ message: "Cart claimed", ownerId: "user-1" })
      : Response.json({ items: [], total: 0 }),
  );
  let completeLogin = () => {};
  const login = new Promise<Awaited<ReturnType<typeof authenticate>>>(
    (resolve) => {
      completeLogin = () =>
        resolve({
          id: "user-1",
          email: "ben@example.com",
          name: "Ben",
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
    },
  );
  vi.mocked(authenticate).mockReturnValueOnce(login);
  const view = renderWithClient(<AccountPanel />);
  await fill();
  fireEvent.click(
    screen.getByRole("button", { name: "Sign in with password" }),
  );
  await waitFor(() => expect(authenticate).toHaveBeenCalled());
  session.isPending = true;
  view.rerender(<AccountPanel />);
  await act(async () => completeLogin());
  await waitFor(() => expect(location.pathname).toBe("/products/1"));
  expect(JSON.parse(localStorage.getItem(key) ?? "null")).toMatchObject({
    ownerId: "user-1",
  });
  expect(
    JSON.parse(localStorage.getItem(key) ?? "null").guestToken,
  ).toBeUndefined();
});
it("uses passkeys independently of password validation and shows cancellation failures", async () => {
  setBrowserOrigin("https://rc-store.benhalverson.dev");
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
it("preserves the account-scoped bag on signout and reports signout failure", async () => {
  session.data = { user: { id: "user-1", email: "ben@example.com" } };
  const key = "lulu-cart-v2:https://api.luluspeedworks.com";
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
  await waitFor(() => expect(session.refetch).toHaveBeenCalled());
  expect(localStorage.getItem(key)).toContain(cartId);
});
it("can retry an interrupted guest claim after the session is restored", async () => {
  session.data = { user: { id: "user-1", email: "ben@example.com" } };
  const cartId = "8cfbf30a-2995-486e-a1e8-8f7d41488f1e";
  const key = "lulu-cart-v2:https://api.luluspeedworks.com";
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
        : Response.json({ message: "claimed", ownerId: "user-1" });
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
  setBrowserOrigin("https://rc-store.benhalverson.dev");
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
  expect(screen.getByRole("button", { name: "Add a passkey" })).toBeVisible();
  session.data = null;
  view.rerender(<AccountPanel />);
  expect(screen.queryByLabelText("First name")).toBeNull();
  expect(screen.queryByRole("button", { name: "Add a passkey" })).toBeNull();
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

it.each(["account", "route", "destination", "unmount"])(
  "ignores late authentication after a different %s owns the page",
  async (change) => {
    window.history.replaceState(null, "", "/signin?returnTo=%2Fcart");
    let finish!: (user: Awaited<ReturnType<typeof authenticate>>) => void;
    vi.mocked(authenticate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const client = testClient();
    client.setQueryData(["private"], "new owner's cache");
    const view = renderWithClient(
      <>
        <AccountPanel />
        <Link to="/signin?returnTo=%2Fproducts%2F2">Change destination</Link>
      </>,
      client,
    );
    await fill();
    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with password" }),
    );
    await waitFor(() => expect(finish).toBeDefined());
    if (change === "account") {
      session.data = { user: { id: "bob", email: "bob@example.com" } };
      view.rerender(<AccountPanel />);
    } else if (change === "route") {
      fireEvent.click(screen.getByRole("link", { name: "Create an account" }));
    } else if (change === "destination") {
      fireEvent.click(screen.getByRole("link", { name: "Change destination" }));
    } else view.unmount();
    await act(async () =>
      finish({
        id: "alice",
        email: "alice@example.com",
        name: "Alice",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    await waitFor(() =>
      expect(
        client
          .getMutationCache()
          .getAll()
          .some((mutation) => mutation.state.status === "error"),
      ).toBe(true),
    );
    expect(client.getQueryData(["private"])).toBe("new owner's cache");
    expect(location.pathname).not.toBe("/cart");
  },
);

it("allows the expected session transition and preserves the destination after explicit claim retry", async () => {
  window.history.replaceState(null, "", "/signin?returnTo=%2Fcart");
  const cartId = "8cfbf30a-2995-486e-a1e8-8f7d41488f1e";
  const key = "lulu-cart-v2:https://api.luluspeedworks.com";
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
  let fail = true;
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).endsWith("/claim"))
      return fail
        ? new Response(null, { status: 503 })
        : Response.json({ message: "claimed", ownerId: "user-1" });
    return Response.json({ items: [], total: 0 });
  });
  const view = renderWithClient(<AccountPanel />);
  vi.mocked(authenticate).mockImplementationOnce(async () => {
    session.data = { user: { id: "user-1", email: "ben@example.com" } };
    view.rerender(<AccountPanel />);
    return {
      ...session.data.user,
      name: "Ben",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });
  await fill();
  fireEvent.click(
    screen.getByRole("button", { name: "Sign in with password" }),
  );
  await screen.findByText(/Bag request failed \(503\)/);
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Restore this bag" }));
  await waitFor(() => expect(location.pathname).toBe("/cart"));
});

it("recovers from an API-hidden expired cart into signin while retaining the bag and local destination", async () => {
  window.history.replaceState(null, "", "/signin?returnTo=%2Fcart");
  session.data = { user: { id: "alice", email: "alice@example.com" } };
  const key = "lulu-cart-v2:https://api.luluspeedworks.com";
  const saved = JSON.stringify({
    cartId: "8cfbf30a-2995-486e-a1e8-8f7d41488f1e",
    ownerId: "alice",
    pending: false,
    revision: crypto.randomUUID(),
  });
  localStorage.setItem(key, saved);
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const view = renderWithClient(<AccountPanel />);
  session.refetch.mockImplementationOnce(async () => {
    session.data = null;
    view.rerender(<AccountPanel />);
  });
  await act(async () => finish(new Response(null, { status: 404 })));
  await screen.findByRole("button", { name: "Sign in with password" });
  expect(localStorage.getItem(key)).toBe(saved);
  expect(location.search).toBe("?returnTo=%2Fcart");
});

it("offers password authentication without RC-bound passkeys on Lulu", () => {
  setBrowserOrigin("https://luluspeedworks.com");
  window.history.replaceState(null, "", "/signin");
  const view = renderWithClient(<AccountPanel />);
  expect(
    screen.getByRole("button", { name: "Sign in with password" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Sign in with a passkey" }),
  ).toBeNull();
  session.data = { user: { id: "alice", email: "alice@example.com" } };
  window.history.replaceState(null, "", "/profile");
  view.unmount();
  renderWithClient(<AccountPanel />);
  expect(screen.queryByRole("button", { name: "Add a passkey" })).toBeNull();
  expect(screen.queryByText("Account security")).toBeNull();
});

it("keeps the guest capability and private cache when the actual SDK confirms another account", async () => {
  window.history.replaceState(null, "", "/signin?returnTo=%2Fcheckout");
  const key = "lulu-cart-v2:https://api.luluspeedworks.com";
  const cartId = "8cfbf30a-2995-486e-a1e8-8f7d41488f1e";
  const guest = JSON.stringify({
    cartId,
    guestToken: cartId,
    ownerId: null,
    pending: false,
    revision: crypto.randomUUID(),
  });
  localStorage.setItem(key, guest);
  const actual = await vi.importActual<typeof import("../src/storefront/auth")>(
    "../src/storefront/auth",
  );
  vi.mocked(authenticate).mockImplementationOnce(actual.authenticate);
  vi.mocked(fetch).mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("sign-in/email"))
      return Response.json({ user: { id: "alice" } });
    if (path.endsWith("get-session"))
      return Response.json({
        user: { id: "bob" },
        session: { id: "bob-session" },
      });
    return Response.json({ items: [], total: 0 });
  });
  const client = testClient();
  client.setQueryData(["private-sentinel"], "retain");
  const cancel = vi.spyOn(client, "cancelQueries");
  const clear = vi.spyOn(client, "clear");
  renderWithClient(<AccountPanel />, client);
  await fill();
  fireEvent.click(
    screen.getByRole("button", { name: "Sign in with password" }),
  );
  await screen.findByText(
    "Your account changed during sign-in. Please try again with the intended account.",
  );
  expect(session.data).toBeNull();
  expect(cancel).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled();
  expect(client.getQueryData(["private-sentinel"])).toBe("retain");
  expect(localStorage.getItem(key)).toBe(guest);
  expect(location.pathname).toBe("/signin");
  expect(
    vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/claim")),
  ).toBe(false);
});
