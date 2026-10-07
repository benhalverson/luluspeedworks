import { z } from "zod";
import { correlation } from "./agent-contract";

const id = z.string().uuid();
const integer = z.number().int().nonnegative().safe();
const productId = z.number().int().positive().safe();
export const selectionSchema = z
  .object({
    productId,
    quantity: z.number().int().min(1).max(69),
    filamentId: id.optional(),
  })
  .strict();
export const agentCartSchema = z
  .object({
    cartId: id,
    revision: integer,
    items: z.array(
      z
        .object({
          id: productId,
          productId: productId.nullable(),
          name: z.string().nullable(),
          quantity: z.number().int().min(1).max(69),
          filamentId: id.nullable(),
          color: z.string().nullable(),
          material: z.string(),
          unitPrice: z.number().finite().nonnegative().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export const appliedSchema = z
  .object({
    status: z.literal("applied"),
    appliedRevision: integer,
    cart: agentCartSchema,
  })
  .strict();
const selectionResult = z
  .object({
    status: z.literal("selected"),
    selection: selectionSchema
      .extend({ filamentId: id, material: z.string(), color: z.string() })
      .strict(),
  })
  .strict();
export const cartEventSchema = z
  .object({
    ...correlation,
    result: z.discriminatedUnion("status", [selectionResult, appliedSchema]),
  })
  .strict();
const reviewSchema = z
  .object({
    quoteId: id,
    cartId: id,
    currency: z.literal("USD"),
    subtotalCents: integer,
    shippingCents: integer,
    totalCents: integer,
    expiresAt: integer,
    confirmationRequired: z.literal(true),
  })
  .strict();
const orderSchema = z
  .object({
    id: productId,
    orderNumber: z.string(),
    paymentStatus: z.string().nullable(),
    fulfillmentState: z.string().nullable(),
    status: z.string().nullable(),
    totalAmountCents: integer.nullable(),
    currency: z.string().nullable(),
    shippedAt: z.string().nullable(),
    deliveredAt: z.string().nullable(),
    refund: z
      .object({
        status: z.string(),
        amountCents: integer.nullable(),
        currency: z.string().nullable(),
        refundedAt: z.string().nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const commerceEventSchema = z
  .object({
    ...correlation,
    result: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("checkout_review"),
          accountId: z.string().min(1),
          status: z.enum([
            "review_required",
            "stale",
            "expired",
            "cart_required",
            "review_already_prepared",
          ]),
          review: reviewSchema.optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("owned_orders"),
          accountId: z.string().min(1),
          status: z.enum(["known", "unknown"]),
          orders: z.array(orderSchema).max(10),
          policy: z.literal("unknown"),
        })
        .strict(),
      z
        .object({
          kind: z.literal("checkout_attempt"),
          accountId: z.string().min(1),
          status: z.enum(["known", "unknown"]),
          attempt: z
            .object({
              attemptId: id,
              state: z.string(),
              order: z
                .object({
                  id: productId,
                  paymentStatus: z.string().nullable(),
                  fulfillmentState: z.string().nullable(),
                  status: z.string().nullable(),
                })
                .strict()
                .nullable(),
            })
            .strict()
            .nullable(),
        })
        .strict(),
    ]),
  })
  .strict();
export type AgentEffect =
  | z.infer<typeof cartEventSchema>["result"]
  | z.infer<typeof commerceEventSchema>["result"];
export type AgentAccess = {
  accountId: string | null;
  cartId?: string;
  guestToken?: string;
  selection?: z.infer<typeof selectionSchema>;
};
export type AgentCommerce = {
  owner: () => string | null | undefined;
  prepare: (signal: AbortSignal) => Promise<AgentAccess>;
  apply: (effects: AgentEffect[]) => Promise<void>;
  refresh: () => Promise<void>;
};

/** Fresh revision reads and receipt recovery never execute a cart or payment mutation. */
export async function readAgentCart(
  origin: string,
  access: AgentAccess,
  signal: AbortSignal,
  receipt?: { sessionId: string; runId: string },
) {
  const suffix = receipt
    ? `agent-actions/${receipt.sessionId}/${receipt.runId}`
    : "agent-state";
  const response = await fetch(
    new URL(`/cart/${access.cartId}/${suffix}`, origin),
    {
      credentials: access.accountId === null ? "omit" : "include",
      cache: "no-store",
      signal,
      headers: {
        ...(access.guestToken ? { "X-Cart-Token": access.guestToken } : {}),
        ...(access.accountId
          ? { "X-Expected-Account-Id": access.accountId }
          : {}),
      },
    },
  );
  if (receipt && response.status === 404) return undefined;
  if ([401, 403, 409].includes(response.status))
    window.dispatchEvent(new Event(`lulu-cart-expired:${origin}`));
  if (!response.ok) throw Error("Shopping bag verification unavailable");
  const value = await response.json();
  const cart = receipt
    ? appliedSchema.parse(value).cart
    : agentCartSchema.parse(value);
  if (cart.cartId !== access.cartId) throw Error("Wrong shopping bag");
  return cart;
}
