import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { CheckoutPage, requestQuote } from "../src/storefront/checkout";
import { renderWithClient, testClient } from "./query-client";

const session = vi.hoisted(() => ({
  data: { user: { id: "alice" } } as { user: { id: string } } | null,
  isPending: false,
  error: null as Error | null,
}));
vi.mock("../src/storefront/auth", async (original) => {
  const actual = await original<typeof import("../src/storefront/auth")>();
  return {
    ...actual,
    authClient: {
      ...actual.authClient,
      $fetch: actual.authClient.$fetch,
      useSession: () => session,
    },
  };
});
const cartId = "11111111-1111-4111-8111-111111111111";
const quoteId = "22222222-2222-4222-8222-222222222222";
const key = "lulu-cart-v2:https://api.benhalverson.dev";
const profile = {
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
};
const bag = {
  items: [
    {
      id: 1,
      productId: "PART",
      name: "Bracket",
      quantity: 2,
      color: "Black",
      filamentType: "PLA",
      filamentId: cartId,
      price: 1.23,
    },
  ],
  total: 2.46,
};
const snapshot = {
  id: quoteId,
  cartId,
  currency: "USD",
  createdAt: Date.now(),
  expiresAt: Date.now() + 900000,
  status: "valid",
  address: {
    name: "Alice Driver",
    line1: profile.address,
    line2: "",
    city: "Portland",
    state: "OR",
    zip: "97201",
    country: "US",
  },
  lines: [
    {
      cartItemId: 1,
      name: "Bracket",
      skuNumber: "PART",
      quantity: 2,
      filamentType: "PLA",
      filamentId: cartId,
      color: "Black",
      unitAmountCents: 123,
      totalAmountCents: 246,
    },
  ],
  subtotalCents: 246,
  shippingCents: 113,
  totalCents: 359,
};
let quoteBody: typeof snapshot;
/** Supplies only local HTTP fixtures while retaining the real profile, cart and quote clients. */
async function respond(input: RequestInfo | URL, init?: RequestInit) {
  const path = new URL(String(input)).pathname;
  if (path === "/profile") return Response.json(profile);
  if (path === "/profile/alice")
    return Response.json({
      id: "alice",
      email: profile.email,
      ...JSON.parse(String(init?.body)),
    });
  if (path === `/cart/${cartId}`) return Response.json(bag);
  if (path.includes("/quotes")) {
    if (init?.method === "POST")
      quoteBody = { ...quoteBody, id: crypto.randomUUID() };
    return Response.json(quoteBody);
  }
  throw new Error(path);
}
/** Requests one review and waits for its independent validity read. */
async function review() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Request a fresh quote" }),
  );
  await screen.findByText("Total (USD)");
}
beforeEach(() => {
  session.data = { user: { id: "alice" } };
  session.error = null;
  session.isPending = false;
  localStorage.clear();
  localStorage.setItem(
    key,
    JSON.stringify({
      cartId,
      ownerId: "alice",
      pending: false,
      revision: quoteId,
    }),
  );
  quoteBody = { ...snapshot, expiresAt: Date.now() + 900000 };
  vi.mocked(fetch).mockImplementation(respond);
});
it("reviews confirmed lines and separate server shipping using empty-body quote requests", async () => {
  renderWithClient(
    <StrictMode>
      <CheckoutPage />
    </StrictMode>,
  );
  await review();
  expect(screen.getByText("$3.59")).toBeVisible();
  expect(screen.getByText("$1.13")).toBeVisible();
  expect(screen.getByText(/Bracket · 2 ×/)).toHaveTextContent("Black · PLA");
  expect(screen.getByText(/Ship to:/)).toHaveTextContent(profile.address);
  expect(screen.getByText(/Payment is not available yet/)).toBeVisible();
  const call = vi
    .mocked(fetch)
    .mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/quotes") && init?.method === "POST",
    );
  expect(call?.[1]).toMatchObject({
    credentials: "include",
    cache: "no-store",
    body: "{}",
  });
});
it("invalidates an existing review on unsaved address changes and waits for a successful save", async () => {
  renderWithClient(<CheckoutPage />);
  await review();
  fireEvent.change(screen.getByLabelText("City"), {
    target: { value: "Salem" },
  });
  expect(screen.queryByText("Total (USD)")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Request a fresh quote" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  await screen.findByText("Profile saved.");
  expect(
    screen.getByRole("button", { name: "Request a fresh quote" }),
  ).toBeEnabled();
  await review();
});
it.each(["stale", "expired"])(
  "hides %s quote amounts and allows explicit fresh review",
  async (status) => {
    quoteBody.status = status;
    renderWithClient(<CheckoutPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Request a fresh quote" }),
    );
    await screen.findByText(
      "This review is no longer valid. Request a fresh quote.",
    );
    expect(screen.queryByText("Total (USD)")).not.toBeInTheDocument();
    quoteBody.status = "valid";
    await review();
  },
);
it("expires locally at the server deadline", async () => {
  quoteBody.expiresAt = Date.now() + 150;
  renderWithClient(<CheckoutPage />);
  await review();
  await screen.findByText(
    "This review is no longer valid. Request a fresh quote.",
  );
  expect(screen.queryByText("Total (USD)")).not.toBeInTheDocument();
});
it.each(["create", "validate"])(
  "fails closed on %s denial and retains profile input for retry",
  async (stage) => {
    vi.mocked(fetch).mockImplementation(async (url, init) =>
      String(url).includes("/quotes") &&
      (stage === "create" ? init?.method === "POST" : init?.method === "GET")
        ? Response.json({}, { status: 401 })
        : respond(url, init),
    );
    renderWithClient(<CheckoutPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Request a fresh quote" }),
    );
    await screen.findByText(/Checkout review unavailable. Check/);
    expect(screen.getByLabelText("Street address")).toHaveValue(
      profile.address,
    );
    expect(screen.queryByText("Total (USD)")).not.toBeInTheDocument();
    vi.mocked(fetch).mockImplementation(respond);
    await review();
  },
);
it.each(["signout", "account", "denial", "edit", "unmount"])(
  "discards pending quote results after %s",
  async (change) => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation((url, init) =>
      String(url).endsWith("/quotes")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : respond(url, init),
    );
    const view = renderWithClient(<CheckoutPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Request a fresh quote" }),
    );
    await screen.findByText("Checking prices and shipping…");
    if (change === "signout") session.data = null;
    if (change === "account") session.data = { user: { id: "bob" } };
    if (change === "denial") session.error = new Error("denied");
    if (change === "edit")
      fireEvent.change(screen.getByLabelText("City"), {
        target: { value: "Salem" },
      });
    if (change === "unmount") view.unmount();
    else view.rerender(<CheckoutPage />);
    await act(async () => finish(Response.json(quoteBody)));
    expect(screen.queryByText("Total (USD)")).not.toBeInTheDocument();
  },
);
it("requires verified session and a nonempty owned confirmed cart", async () => {
  session.isPending = true;
  const view = renderWithClient(<CheckoutPage />);
  expect(
    screen.getByRole("link", { name: "Sign in to review your checkout" }),
  ).toBeVisible();
  session.isPending = false;
  localStorage.clear();
  view.rerender(<CheckoutPage />);
  await screen.findByText(/Return to your bag to confirm/);
  expect(
    screen.queryByRole("button", { name: "Request a fresh quote" }),
  ).not.toBeInTheDocument();
});
it("rejects mismatched cart DTOs and already expired timestamps", async () => {
  quoteBody.cartId = quoteId;
  await expect(requestQuote(cartId)).rejects.toThrow();
  quoteBody = { ...snapshot, expiresAt: Date.now() - 1000 };
  renderWithClient(<CheckoutPage />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Request a fresh quote" }),
  );
  await screen.findByText(
    "This review is no longer valid. Request a fresh quote.",
  );
});
it("clears a review when another tab changes the bag", async () => {
  renderWithClient(<CheckoutPage />);
  await review();
  localStorage.setItem(
    key,
    JSON.stringify({
      cartId,
      ownerId: "alice",
      pending: true,
      revision: crypto.randomUUID(),
    }),
  );
  act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
  await waitFor(() =>
    expect(screen.queryByText("Total (USD)")).not.toBeInTheDocument(),
  );
});

it("discards a pending review after a protected profile read is denied", async () => {
  let finish!: (value: Response) => void;
  let denied = false;
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (String(url).endsWith("/profile") && denied)
      return Promise.resolve(Response.json({}, { status: 401 }));
    if (String(url).endsWith("/quotes"))
      return new Promise((resolve) => {
        finish = resolve;
      });
    return respond(url, init);
  });
  const client = testClient();
  renderWithClient(<CheckoutPage />, client);
  fireEvent.click(
    await screen.findByRole("button", { name: "Request a fresh quote" }),
  );
  await screen.findByText("Checking prices and shipping…");
  denied = true;
  await act(() => client.invalidateQueries({ queryKey: ["profile"] }));
  await screen.findByText("Profile unavailable. Retry or sign in again.");
  await act(async () => finish(Response.json(quoteBody)));
  expect(screen.queryByText("Total (USD)")).not.toBeInTheDocument();
  denied = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry profile" }));
  await screen.findByLabelText("City");
  expect(screen.queryByText("Total (USD)")).not.toBeInTheDocument();
});
it("disables profile fields during a save and requires retry after a denied save", async () => {
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementation((url, init) =>
    String(url).endsWith("/profile/alice")
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : respond(url, init),
  );
  renderWithClient(<CheckoutPage />);
  await review();
  fireEvent.change(screen.getByLabelText("City"), {
    target: { value: "Salem" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  await waitFor(() => expect(screen.getByLabelText("City")).toBeDisabled());
  await act(async () => finish(Response.json({}, { status: 403 })));
  await screen.findByText(
    "Profile could not be saved. Check your details and try again.",
  );
  expect(screen.getByLabelText("City")).toHaveValue("Salem");
  expect(screen.queryByText("Total (USD)")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Request a fresh quote" }),
  ).not.toBeInTheDocument();
});

it.each([200, 403])(
  "cannot restore profile verification from a late save response %s",
  async (status) => {
    let finish!: (value: Response) => void;
    let profileStatus = 200;
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (String(url).endsWith("/profile/alice"))
        return new Promise((resolve) => {
          finish = resolve;
        });
      if (String(url).endsWith("/profile") && profileStatus !== 200)
        return Promise.resolve(Response.json({}, { status: profileStatus }));
      return respond(url, init);
    });
    const client = testClient();
    renderWithClient(<CheckoutPage />, client);
    await screen.findByLabelText("City");
    fireEvent.change(screen.getByLabelText("City"), {
      target: { value: "Salem" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(screen.getByLabelText("City")).toBeDisabled());
    profileStatus = 401;
    await act(() => client.invalidateQueries({ queryKey: ["profile"] }));
    await screen.findByText("Profile unavailable. Retry or sign in again.");
    await act(async () =>
      finish(
        Response.json(
          { ...profile, shippingAddress: profile.address, city: "Salem" },
          { status },
        ),
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Request a fresh quote" }),
    ).not.toBeInTheDocument();
    profileStatus = 503;
    fireEvent.click(screen.getByRole("button", { name: "Retry profile" }));
    await screen.findByText("Profile unavailable. Retry or sign in again.");
    expect(
      screen.queryByRole("button", { name: "Request a fresh quote" }),
    ).not.toBeInTheDocument();
    profileStatus = 200;
    fireEvent.click(screen.getByRole("button", { name: "Retry profile" }));
    await screen.findByLabelText("City");
    expect(
      screen.getByRole("button", { name: "Request a fresh quote" }),
    ).toBeDisabled();
  },
);
