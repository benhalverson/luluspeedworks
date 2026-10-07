import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { z } from "zod";
import { BrandLink } from "../components/brand-link";
import { Button } from "../components/ui/button";
import { apiOrigin, authClient } from "./auth";
import { useCart } from "./cart";
import { useCartSessionRecovery } from "./cart-session";
import { PaymentRecovery, useCheckoutPayment } from "./checkout-payment";
import { ProfilePanel } from "./profile";

const cents = z.number().int().safe().nonnegative();
export const checkoutQuoteSchema = z.object({
  id: z.string().uuid(),
  cartId: z.string().uuid(),
  currency: z.literal("USD"),
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  status: z.enum(["valid", "stale", "expired"]),
  address: z.object({
    name: z.string(),
    line1: z.string(),
    line2: z.string(),
    city: z.string(),
    state: z.string(),
    zip: z.string(),
    country: z.string(),
  }),
  lines: z
    .array(
      z.object({
        cartItemId: z.number().int(),
        name: z.string(),
        skuNumber: z.string(),
        quantity: z.number().int().min(1).max(69),
        filamentType: z.string(),
        filamentId: z.string().uuid(),
        color: z.string(),
        unitAmountCents: cents,
        totalAmountCents: cents,
      }),
    )
    .min(1),
  subtotalCents: cents,
  shippingCents: cents,
  totalCents: cents,
});
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** Requests an owned server quote; only cart and quote identifiers leave the browser. */
export async function requestQuote(
  cartId: string,
  quoteId?: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    new URL(`/cart/${cartId}/quotes${quoteId ? `/${quoteId}` : ""}`, apiOrigin),
    {
      method: quoteId ? "GET" : "POST",
      credentials: "include",
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
      ...(!quoteId
        ? { headers: { "Content-Type": "application/json" }, body: "{}" }
        : {}),
    },
  );
  if ([401, 403].includes(response.status))
    window.dispatchEvent(new Event(`lulu-cart-expired:${apiOrigin}`));
  if (!response.ok)
    throw new Error(
      `Checkout review unavailable (${response.status}). Check your shipping profile and bag, then retry.`,
    );
  return checkoutQuoteSchema
    .refine((quote) => quote.cartId === cartId)
    .parse(await response.json());
}

/** Owns one mounted cart/profile review; unmounting discards pending response ownership. */
function QuoteReview({
  cartId,
  enabled,
  payment,
}: {
  cartId: string;
  enabled: boolean;
  payment: ReturnType<typeof useCheckoutPayment>;
}) {
  const create = useMutation({
    mutationFn: () => requestQuote(cartId),
    retry: false,
  });
  const quote = useQuery({
    queryKey: ["checkout-quote", cartId, create.data?.id],
    queryFn: ({ signal }) => requestQuote(cartId, create.data?.id, signal),
    enabled: enabled && create.isSuccess,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 30_000,
  });
  const [expired, setExpired] = useState(false);
  const expiresAt = create.data?.expiresAt;
  useEffect(() => {
    setExpired(false);
    if (expiresAt === undefined) return;
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(0, expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt]);
  const reviewed =
    enabled &&
    !create.isPending &&
    !quote.isFetching &&
    quote.isSuccess &&
    !expired &&
    quote.data.status === "valid"
      ? quote.data
      : undefined;
  return (
    <section
      aria-label="Checkout review"
      className="mt-8 grid gap-3 border-t border-border pt-6"
    >
      <h2 className="font-display text-2xl">Review your checkout</h2>
      <p>
        Save your shipping address, then request a current quote for your
        confirmed bag. Shipping is shown separately in USD.
      </p>
      <Button
        disabled={!enabled || create.isPending || quote.isFetching}
        onClick={() => create.mutate()}
      >
        Request a fresh quote
      </Button>
      {create.isPending || quote.isFetching ? (
        <p role="status">Checking prices and shipping…</p>
      ) : null}
      {create.error || quote.isError ? (
        <p role="alert">
          Checkout review unavailable. Check your bag and shipping profile, then
          request a fresh quote.
        </p>
      ) : null}
      {expired || (quote.isSuccess && quote.data.status !== "valid") ? (
        <p role="alert">
          This review is no longer valid. Request a fresh quote.
        </p>
      ) : null}
      {reviewed ? (
        <div className="grid gap-3">
          <h3 className="font-display text-xl">Confirmed items</h3>
          <ul>
            {reviewed.lines.map((line) => (
              <li key={line.cartItemId} className="border-b border-border py-2">
                {line.name} · {line.quantity} ×{" "}
                {money.format(line.unitAmountCents / 100)} · {line.color} ·{" "}
                {line.filamentType} ·{" "}
                {money.format(line.totalAmountCents / 100)}
              </li>
            ))}
          </ul>
          <p>
            Ship to: {reviewed.address.name}, {reviewed.address.line1}{" "}
            {reviewed.address.line2}, {reviewed.address.city},{" "}
            {reviewed.address.state} {reviewed.address.zip},{" "}
            {reviewed.address.country}
          </p>
          <dl className="grid grid-cols-2 gap-2">
            <dt>Items</dt>
            <dd>{money.format(reviewed.subtotalCents / 100)}</dd>
            <dt>Shipping</dt>
            <dd>{money.format(reviewed.shippingCents / 100)}</dd>
            <dt>Total (USD)</dt>
            <dd className="font-bold">
              {money.format(reviewed.totalCents / 100)}
            </dd>
          </dl>
          <p className="text-sm">
            Valid until {new Date(reviewed.expiresAt).toLocaleTimeString()}.
            Changes to your bag, address or catalog require a fresh review.
          </p>
          <p>
            Continue to Square to enter payment details and explicitly authorize
            payment. Returning here does not confirm payment.
          </p>
          <Button
            disabled={payment.blocked}
            onClick={() =>
              payment.mutation.mutate({ kind: "confirm", quote: reviewed })
            }
          >
            Continue to Square — {money.format(reviewed.totalCents / 100)} USD
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Keeps saved-profile edits and quote requests within one verified account and cart visit. */
function CustomerCheckout({ userId }: { userId: string }) {
  const bag = useCart(apiOrigin, userId);
  const payment = useCheckoutPayment(userId);
  const [profileRevision, setProfileRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const ready =
    profileReady &&
    bag.cart.isSuccess &&
    !bag.cart.isFetching &&
    !bag.uncertain &&
    !bag.claimable &&
    !bag.mutation.isPending &&
    bag.cart.data.items.length > 0;
  return (
    <>
      <PaymentRecovery payment={payment} />
      <div
        onChangeCapture={() => {
          setDirty(true);
          setProfileRevision((value) => value + 1);
        }}
      >
        <ProfilePanel
          userId={userId}
          onSaved={() => setDirty(false)}
          onReady={setProfileReady}
        />
      </div>
      {!ready ? (
        <p role="status">
          Return to your bag to confirm its items and ownership before
          requesting a quote.
        </p>
      ) : null}
      {bag.cartId && ready ? (
        <QuoteReview
          key={`${bag.cartId}:${bag.revision}:${JSON.stringify(bag.cart.data)}:${profileRevision}`}
          cartId={bag.cartId}
          enabled={!dirty}
          payment={payment}
        />
      ) : null}
    </>
  );
}

/** Renders the shipping review route only for a currently verified customer session. */
export function CheckoutPage() {
  const session = authClient.useSession();
  useCartSessionRecovery(apiOrigin, session.refetch);
  const userId = session.data?.user?.id;
  return (
    <main className="mx-auto max-w-3xl p-6">
      <BrandLink />
      <h1 className="font-display text-3xl">Shipping and checkout review</h1>
      <Link className="my-4 block underline" to="/">
        Return to your bag
      </Link>
      {session.isPending || session.error || !userId ? (
        <p>
          <Link className="underline" to="/signin?returnTo=%2Fcheckout">
            Sign in to review your checkout
          </Link>
        </p>
      ) : (
        <CustomerCheckout key={userId} userId={userId} />
      )}
    </main>
  );
}
