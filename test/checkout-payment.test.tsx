import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  PaymentRecovery,
  useCheckoutPayment,
} from "../src/storefront/checkout-payment";
import { renderWithClient } from "./query-client";

const key = "lulu-checkout-v1:https://api.luluspeedworks.com:alice";
const saved = {
  requestKey: "8cfbf30a-2995-486e-a1e8-8f7d41488f1e",
  cartId: "6f605c5e-c558-4a88-9885-84640d327fe6",
  quoteId: "fb5814e7-c8aa-4dde-a98b-3f3597e5526c",
};
const attemptId = "c34ca8d0-c9c5-458e-839b-a6a63c76d809";
const quote = {
  id: saved.quoteId,
  cartId: saved.cartId,
  expiresAt: Date.now() + 3600000,
  status: "valid" as const,
};
const initial = {
  attemptId,
  quoteId: saved.quoteId,
  state: "initiating",
  paymentUrl: "https://square.link/u/fixture",
  squareOrderId: "square-order",
};
const pending = {
  attemptId,
  quoteId: saved.quoteId,
  cartId: saved.cartId,
  state: "pending",
  paymentUrl: initial.paymentUrl,
  order: null,
};
let response: unknown;
let postStatus: number;
let writes: Record<string, unknown>[];

function Controls({
  userId = "alice",
  expiresAt = quote.expiresAt,
}: {
  userId?: string;
  expiresAt?: number;
}) {
  const payment = useCheckoutPayment(userId);
  return (
    <>
      <button
        type="button"
        onClick={() =>
          payment.mutation.mutate({
            kind: "confirm",
            quote: { ...quote, expiresAt },
          })
        }
      >
        Confirm test quote
      </button>
      <button
        type="button"
        onClick={() =>
          payment.mutation.mutate({
            kind: "retry",
            requestKey: saved.requestKey,
          })
        }
      >
        Retry old identity
      </button>
      <button
        type="button"
        onClick={() =>
          payment.mutation.mutate({
            kind: "clear",
            requestKey: saved.requestKey,
          })
        }
      >
        Clear old identity
      </button>
      <PaymentRecovery payment={payment} />
    </>
  );
}
function seed(value: unknown = saved) {
  localStorage.setItem(key, JSON.stringify(value));
}
function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}
beforeEach(() => {
  localStorage.clear();
  response = pending;
  postStatus = 200;
  writes = [];
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (_key: string, callback: () => Promise<void>) =>
        callback(),
    },
  });
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    expect(init?.credentials).toBe("include");
    expect(init?.cache).toBe("no-store");
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      expect(JSON.parse(localStorage.getItem(key) ?? "null")).toMatchObject(
        body,
      );
      writes.push(body);
      return Response.json(initial, { status: postStatus });
    }
    return Response.json(response);
  });
});
afterEach(() => {
  Reflect.deleteProperty(navigator, "locks");
});

it("persists one identity before submitting only identifiers and prevents a duplicate confirmation", async () => {
  renderWithClient(<Controls />);
  click("Confirm test quote");
  await screen.findByRole("link", {
    name: "Continue this checkout with Square",
  });
  expect(writes).toHaveLength(1);
  const stored = JSON.parse(localStorage.getItem(key) ?? "null");
  expect(writes[0]).toEqual({
    quoteId: saved.quoteId,
    requestKey: stored.requestKey,
  });
  click("Confirm test quote");
  await waitFor(() =>
    expect(screen.queryByText(/Contacting Square/)).toBeNull(),
  );
  expect(writes).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem(key) ?? "null")).toEqual(stored);
});

it.each(["unknown", "pending", "failed", "cancelled", "paid"])(
  "reload recovery reads verified %s without a checkout POST",
  async (state) => {
    seed();
    response = {
      ...pending,
      state,
      paymentUrl:
        state === "paid" || state === "unknown" ? null : pending.paymentUrl,
    };
    const view = renderWithClient(<Controls />);
    await waitFor(() =>
      expect(screen.queryByText("Checking your checkout…")).toBeNull(),
    );
    expect(
      screen.getByRole("region", { name: "Payment outcome" }),
    ).toHaveTextContent(
      state === "paid"
        ? "Payment confirmed"
        : state === "pending"
          ? "Payment is pending"
          : state === "unknown"
            ? "creation is unresolved"
            : state === "failed"
              ? "failed payment"
              : "cancelled payment",
    );
    expect(writes).toEqual([]);
    if (state === "paid")
      expect(screen.getByText(/paid order is being recorded/)).toBeVisible();
    view.unmount();
    renderWithClient(<Controls />);
    await screen.findByRole("button", { name: "Check payment outcome" });
    expect(writes).toEqual([]);
  },
);

it("recovers a lost initiation acknowledgement and explicitly retries the original key", async () => {
  let calls = 0;
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    if (init?.method === "POST") {
      writes.push(JSON.parse(String(init.body)));
      if (++calls === 1) throw Error("lost response");
      response = pending;
      return Response.json(initial);
    }
    return Response.json(response);
  });
  response = { ...pending, state: "unknown", paymentUrl: null };
  renderWithClient(<Controls />);
  click("Confirm test quote");
  await screen.findByText(/original checkout identity is retained/);
  const retry = await screen.findByRole("button", {
    name: "Retry this same checkout",
  });
  await waitFor(() => expect(retry).toBeEnabled());
  fireEvent.click(retry);
  await screen.findByRole("link", {
    name: "Continue this checkout with Square",
  });
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
});

it.each([401, 403, 409, 502])(
  "preserves identity after initiation HTTP %s and independently reads its outcome",
  async (status) => {
    postStatus = status;
    const expired = vi.fn();
    window.addEventListener(
      "lulu-cart-expired:https://api.luluspeedworks.com",
      expired,
    );
    try {
      renderWithClient(<Controls />);
      click("Confirm test quote");
      await screen.findByText(/original checkout identity is retained/);
      await screen.findByRole("link", {
        name: "Continue this checkout with Square",
      });
      expect(writes).toHaveLength(1);
      expect(expired).toHaveBeenCalledTimes(
        status === 401 || status === 403 ? 1 : 0,
      );
    } finally {
      window.removeEventListener(
        "lulu-cart-expired:https://api.luluspeedworks.com",
        expired,
      );
    }
  },
);

it.each([401, 403, 404, 503])(
  "keeps a status-read HTTP %s unknown and offers an explicit read retry",
  async (status) => {
    seed();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status }));
    renderWithClient(<Controls />);
    await screen.findByText(/Payment outcome is unknown/);
    click("Check payment outcome");
    await screen.findByRole("link", {
      name: "Continue this checkout with Square",
    });
    expect(writes).toEqual([]);
  },
);

it.each([
  { ...pending, quoteId: saved.cartId },
  { ...pending, cartId: saved.quoteId },
  { ...pending, state: "redirected" },
  ...[
    "https://evil.test/pay",
    "http://square.link/pay",
    "https://user@square.link/pay",
    "https://:password@square.link/pay",
    "https://square.link:8443/pay",
    "javascript:alert(1)",
  ].map((paymentUrl) => ({ ...pending, paymentUrl })),
])("rejects uncorrelated or unsafe payment outcomes: %j", async (value) => {
  seed();
  response = value;
  renderWithClient(<Controls />);
  await screen.findByText(/Payment outcome is unknown/);
  expect(
    screen.queryByRole("link", { name: "Continue this checkout with Square" }),
  ).toBeNull();
  expect(writes).toEqual([]);
});

it("retains the request key when a successful initiation response identifies another quote", async () => {
  vi.mocked(fetch).mockImplementation(async (_url, init) =>
    Response.json(
      init?.method === "POST" ? { ...initial, quoteId: saved.cartId } : pending,
    ),
  );
  renderWithClient(<Controls />);
  click("Confirm test quote");
  await screen.findByText(/original checkout identity is retained/);
  await screen.findByRole("link", {
    name: "Continue this checkout with Square",
  });
});

it.each(["invalid-json", "invalid-shape"])(
  "fails closed on %s saved identity",
  async (value) => {
    localStorage.setItem(
      key,
      value === "invalid-json" ? "{" : JSON.stringify({ requestKey: "bad" }),
    );
    renderWithClient(<Controls />);
    await screen.findByText(/Saved checkout identity is unreadable/);
    click("Confirm test quote");
    await screen.findByText(/Checkout could not start/);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("refuses initiation when durable storage fails", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("quota");
  });
  renderWithClient(<Controls />);
  click("Confirm test quote");
  await screen.findByText(/Checkout could not start/);
  expect(fetch).not.toHaveBeenCalled();
});

it("refuses expired quote confirmation and unavailable cross-tab locks", async () => {
  const view = renderWithClient(<Controls expiresAt={0} />);
  click("Confirm test quote");
  await screen.findByText(/Checkout could not start/);
  expect(fetch).not.toHaveBeenCalled();
  Reflect.deleteProperty(navigator, "locks");
  view.rerender(<Controls />);
  click("Confirm test quote");
  await screen.findByText(/Checkout could not start/);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["Retry old identity", "Clear old identity"])(
  "rejects %s after storage changes or disappears",
  async (name) => {
    seed({ ...saved, requestKey: saved.cartId });
    const view = renderWithClient(<Controls />);
    await screen.findByRole("link", {
      name: "Continue this checkout with Square",
    });
    click(name);
    await screen.findByText(/original checkout identity is retained/);
    view.unmount();
    localStorage.clear();
    renderWithClient(<Controls />);
    click(name);
    await screen.findByText(/Checkout could not start/);
    expect(writes).toEqual([]);
  },
);

it("only clears a freshly verified paid attempt, retaining it through storage failure", async () => {
  seed();
  const view = renderWithClient(<Controls />);
  await screen.findByRole("link", {
    name: "Continue this checkout with Square",
  });
  click("Clear old identity");
  await screen.findByText(/original checkout identity is retained/);
  expect(localStorage.getItem(key)).toBe(JSON.stringify(saved));
  response = {
    ...pending,
    state: "paid",
    paymentUrl: null,
    order: {
      id: 1,
      paymentStatus: "paid",
      fulfillmentState: null,
      status: null,
    },
  };
  click("Check payment outcome");
  await screen.findByRole("link", { name: "View this order" });
  expect(screen.getByText(/Fulfillment: Not yet available/)).toBeVisible();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const storage = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw Error("quota");
    });
  click("Start another checkout");
  await screen.findByText(/original checkout identity is retained/);
  expect(localStorage.getItem(key)).toBe(JSON.stringify(saved));
  storage.mockRestore();
  click("Start another checkout");
  await waitFor(() => expect(localStorage.getItem(key)).toBe("null"));
  view.unmount();
});

it("does not run a queued confirmation after its visit ends", async () => {
  let run!: () => Promise<void>;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_key: string, callback: () => Promise<void>) =>
        new Promise<void>((resolve, reject) => {
          run = async () => {
            try {
              await callback();
              resolve();
            } catch (error) {
              reject(error);
            }
          };
        }),
    },
  });
  const view = renderWithClient(<Controls />);
  click("Confirm test quote");
  await waitFor(() => expect(run).toBeTypeOf("function"));
  view.unmount();
  await act(async () => run());
  expect(fetch).not.toHaveBeenCalled();
});

it("hides the previous account's payment result and never auto-submits on account changes", async () => {
  seed();
  response = {
    ...pending,
    state: "paid",
    paymentUrl: null,
    order: {
      id: 1,
      paymentStatus: "paid",
      fulfillmentState: "ready",
      status: "paid",
    },
  };
  const view = renderWithClient(<Controls key="alice" />);
  await screen.findByText(/Payment confirmed/);
  view.rerender(<Controls key="bob" userId="bob" />);
  expect(screen.queryByText(/Payment confirmed/)).toBeNull();
  expect(writes).toEqual([]);
});

it("does not clear a saved attempt when paid verification finishes after leaving checkout", async () => {
  seed();
  const view = renderWithClient(<Controls />);
  await screen.findByRole("link", {
    name: "Continue this checkout with Square",
  });
  let complete!: (value: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      complete = resolve;
    }),
  );
  click("Clear old identity");
  await waitFor(() => expect(complete).toBeTypeOf("function"));
  view.unmount();
  await act(async () =>
    complete(Response.json({ ...pending, state: "paid", paymentUrl: null })),
  );
  expect(localStorage.getItem(key)).toBe(JSON.stringify(saved));
});
