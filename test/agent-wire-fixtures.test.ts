import { expect, it, vi } from "vitest";
import {
  agentCartSchema,
  appliedSchema,
  commerceEventSchema,
  readAgentCart,
} from "../src/storefront/agent-commerce";

// Synthetic v1 response contracts: no companion checkout or backend execution.
const id = "11111111-1111-4111-8111-111111111111";
const correlation = { runId: id, uiRevision: 1 };
const cart = {
  cartId: id,
  revision: 2,
  items: [
    {
      id: 1,
      productId: 42,
      name: "Physical part",
      quantity: 2,
      filamentId: id,
      color: "Red",
      material: "PLA",
      unitPrice: 15,
    },
  ],
};
const fixtures = [
  {
    kind: "checkout_review",
    accountId: "alice",
    status: "review_required",
    review: {
      quoteId: id,
      cartId: id,
      currency: "USD",
      subtotalCents: 3000,
      shippingCents: 500,
      totalCents: 3500,
      expiresAt: 9000000000000,
      confirmationRequired: true,
    },
  },
  {
    kind: "owned_orders",
    accountId: "alice",
    status: "known",
    policy: "unknown",
    orders: [
      {
        id: 42,
        orderNumber: "ORDER-42",
        paymentStatus: "paid",
        fulfillmentState: "failed",
        status: "paid",
        totalAmountCents: 3500,
        currency: "USD",
        shippedAt: null,
        deliveredAt: null,
        refund: {
          status: "pending",
          amountCents: 500,
          currency: "USD",
          refundedAt: null,
        },
      },
    ],
  },
  {
    kind: "checkout_attempt",
    accountId: "alice",
    status: "known",
    attempt: {
      attemptId: id,
      state: "paid",
      order: {
        id: 42,
        paymentStatus: "paid",
        fulfillmentState: "pending",
        status: "paid",
      },
    },
  },
  {
    kind: "checkout_attempt",
    accountId: "alice",
    status: "unknown",
    attempt: null,
  },
];
it.each(fixtures)(
  "accepts the mocked $kind/$status wire fixture without network",
  (result) => {
    expect(
      commerceEventSchema.parse({ ...correlation, result }).result,
    ).toEqual(result);
    expect(fetch).not.toHaveBeenCalled();
  },
);
it.each(fixtures)(
  "rejects private unexpected fields in $kind/$status",
  (result) => {
    expect(
      commerceEventSchema.safeParse({
        ...correlation,
        result: { ...result, email: "private@example.test" },
      }).success,
    ).toBe(false);
  },
);
it("reads mocked state and receipt without repeating any cart mutation", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json(cart))
    .mockResolvedValueOnce(
      Response.json({ status: "applied", appliedRevision: 1, cart }),
    );
  const access = { accountId: "alice", cartId: id };
  const signal = new AbortController().signal;
  expect(await readAgentCart("https://api.lulu.test", access, signal)).toEqual(
    agentCartSchema.parse(cart),
  );
  expect(
    await readAgentCart("https://api.lulu.test", access, signal, {
      sessionId: id,
      runId: id,
    }),
  ).toEqual(
    appliedSchema.parse({ status: "applied", appliedRevision: 1, cart }).cart,
  );
  expect(
    vi.mocked(fetch).mock.calls.map(([, init]) => init?.method ?? "GET"),
  ).toEqual(["GET", "GET"]);
});
it("never accepts a quote contract that removes explicit confirmation", () => {
  const result = fixtures[0];
  expect(
    commerceEventSchema.safeParse({
      ...correlation,
      result: {
        ...result,
        review: { ...result?.review, confirmationRequired: false },
      },
    }).success,
  ).toBe(false);
});
