import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import { Button } from "../components/ui/button";
import { apiOrigin } from "./auth";

const savedSchema = z
  .object({
    requestKey: z.string().uuid(),
    cartId: z.string().uuid(),
    quoteId: z.string().uuid(),
  })
  .strict();
type SavedAttempt = z.infer<typeof savedSchema>;
type StoredAttempt = SavedAttempt | null | "invalid";
const squareUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["square.link", "sandbox.square.link"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port
    );
  });
const outcomeSchema = z.object({
  attemptId: z.string().uuid(),
  quoteId: z.string().uuid(),
  cartId: z.string().uuid(),
  state: z.enum(["pending", "unknown", "failed", "cancelled", "paid"]),
  paymentUrl: squareUrl.nullable(),
  order: z
    .object({
      id: z.number().int().positive(),
      paymentStatus: z.string().nullable(),
      fulfillmentState: z.string().nullable(),
      status: z.string().nullable(),
    })
    .nullable(),
});
const initiationSchema = z.object({
  attemptId: z.string().uuid(),
  quoteId: z.string().uuid(),
  state: z.string(),
  paymentUrl: squareUrl.nullable(),
  squareOrderId: z.string().nullable(),
});
type Quote = {
  id: string;
  cartId: string;
  expiresAt: number;
  status: "valid" | "stale" | "expired";
};

/** Corrupt hints block replacement: never silently generate a second request identity. */
function decode(value: string): StoredAttempt {
  try {
    return savedSchema.nullable().parse(JSON.parse(value));
  } catch {
    return "invalid";
  }
}

/** Only authenticated, correlated server reads establish an outcome; a redirect is never evidence. */
async function readOutcome(saved: SavedAttempt, signal?: AbortSignal) {
  const response = await fetch(
    new URL(`/checkout-attempts/by-request-key/${saved.requestKey}`, apiOrigin),
    {
      credentials: "include",
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    },
  );
  if ([401, 403].includes(response.status))
    window.dispatchEvent(new Event(`lulu-cart-expired:${apiOrigin}`));
  if (!response.ok)
    throw new Error(
      "The checkout outcome could not be verified. Keep this checkout identity and check again.",
    );
  return outcomeSchema
    .refine(
      (value) =>
        value.quoteId === saved.quoteId && value.cartId === saved.cartId,
    )
    .parse(await response.json());
}

/** Serialize explicit submissions and persist identity before sending any checkout request. */
export function useCheckoutPayment(userId: string) {
  const queryClient = useQueryClient();
  const key = `lulu-checkout-v1:${apiOrigin}:${userId}`;
  const [saved, setSaved] = useLocalStorage<StoredAttempt>(key, null, {
    deserializer: decode,
  });
  const visit = useRef(0);
  useEffect(() => {
    visit.current += 1;
    return () => {
      visit.current += 1;
    };
  }, []);
  const mutation = useMutation({
    retry: false,
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ["checkout-outcome", apiOrigin, userId],
      }),
    mutationFn: async (
      input:
        | { kind: "confirm"; quote: Quote }
        | { kind: "retry" | "clear"; requestKey: string },
    ) => {
      const owner = visit.current;
      const assertCurrent = () => {
        if (visit.current !== owner)
          throw new Error(
            "Return to checkout and verify your account before continuing.",
          );
      };
      if (!navigator.locks)
        throw new Error(
          "Checkout requires a browser with secure cross-tab locks.",
        );
      await navigator.locks.request(key, async () => {
        assertCurrent();
        const current = decode(localStorage.getItem(key) ?? "null");
        if (current === "invalid")
          throw new Error(
            "Saved checkout identity is unreadable. Contact the store before starting another checkout.",
          );
        if (input.kind === "clear") {
          if (!current || current.requestKey !== input.requestKey)
            throw new Error("The saved checkout changed. Refresh its outcome.");
          const outcome = await readOutcome(current);
          assertCurrent();
          if (outcome.state !== "paid")
            throw new Error(
              "This checkout is not confirmed paid. Keep its original identity.",
            );
          setSaved(null);
          if (localStorage.getItem(key) !== "null")
            throw new Error("Checkout recovery storage is unavailable.");
          return;
        }
        let attempt: SavedAttempt;
        if (input.kind === "confirm") {
          if (current) {
            setSaved(current);
            return;
          }
          if (
            input.quote.status !== "valid" ||
            input.quote.expiresAt <= Date.now()
          )
            throw new Error(
              "Request a fresh quote before continuing to Square.",
            );
          attempt = {
            requestKey: crypto.randomUUID(),
            quoteId: input.quote.id,
            cartId: input.quote.cartId,
          };
          setSaved(attempt);
          if (localStorage.getItem(key) !== JSON.stringify(attempt))
            throw new Error(
              "Checkout recovery storage is unavailable. No checkout was submitted.",
            );
        } else {
          if (!current || current.requestKey !== input.requestKey)
            throw new Error("The saved checkout changed. Refresh its outcome.");
          attempt = current;
        }
        assertCurrent();
        const response = await fetch(
          new URL(`/cart/${attempt.cartId}/checkout`, apiOrigin),
          {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              quoteId: attempt.quoteId,
              requestKey: attempt.requestKey,
            }),
            signal: AbortSignal.timeout(20_000),
          },
        );
        if ([401, 403].includes(response.status))
          window.dispatchEvent(new Event(`lulu-cart-expired:${apiOrigin}`));
        if (!response.ok)
          throw new Error(
            "Checkout was not confirmed. Check its outcome before retrying with the same identity.",
          );
        initiationSchema
          .refine((value) => value.quoteId === attempt.quoteId)
          .parse(await response.json());
      });
    },
  });
  const attempt = saved && saved !== "invalid" ? saved : null;
  const outcome = useQuery({
    queryKey: ["checkout-outcome", apiOrigin, userId, attempt?.requestKey],
    queryFn: ({ signal }) => readOutcome(savedSchema.parse(attempt), signal),
    enabled: Boolean(attempt) && !mutation.isPending,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  return {
    saved,
    attempt,
    outcome,
    mutation,
    blocked: saved !== null || mutation.isPending,
  };
}

/** Recover passively across reloads; only explicit buttons can create or retry checkout. */
export function PaymentRecovery({
  payment,
}: {
  payment: ReturnType<typeof useCheckoutPayment>;
}) {
  const { saved, attempt, outcome, mutation } = payment;
  const verified =
    !mutation.isPending && !outcome.isFetching && outcome.isSuccess
      ? outcome.data
      : null;
  if (saved === null && !mutation.isPending && !mutation.isError) return null;
  return (
    <section
      aria-label="Payment outcome"
      className="my-6 grid gap-3 border-t border-border pt-6"
    >
      {saved === "invalid" ? (
        <p role="alert">
          Saved checkout identity is unreadable. Contact the store before
          starting another checkout.
        </p>
      ) : null}
      {mutation.isPending ? (
        <p role="status">
          Contacting Square checkout. Keep this page or return here to verify
          the outcome.
        </p>
      ) : null}
      {mutation.isError ? (
        <p role="alert">
          {attempt
            ? "Checkout was not confirmed. Your original checkout identity is retained. Check its outcome before retrying."
            : "Checkout could not start. Check browser storage and secure browser locks, then try again."}
        </p>
      ) : null}
      {attempt ? (
        <>
          <h2 className="font-display text-2xl">Your checkout outcome</h2>
          {outcome.isFetching ? (
            <p role="status">Checking your checkout…</p>
          ) : null}
          {outcome.isError ? (
            <p role="alert">
              Payment outcome is unknown. A timeout or redirect does not mean
              paid. Check again, or explicitly retry this same checkout.
            </p>
          ) : null}
          {verified ? (
            <p role="status">
              {
                {
                  pending:
                    "Payment is pending. Complete this checkout with Square, then check its outcome.",
                  unknown:
                    "Square checkout creation is unresolved. Retry only this same checkout.",
                  failed:
                    "Square reports a failed payment. No successful payment is confirmed; keep this checkout identity.",
                  cancelled:
                    "Square reports a cancelled payment. Keep this checkout identity when continuing.",
                  paid: "Payment confirmed. Fulfillment is tracked separately; do not pay again.",
                }[verified.state]
              }
            </p>
          ) : null}
          <Button
            variant="outline"
            disabled={mutation.isPending || outcome.isFetching}
            onClick={() => void outcome.refetch()}
          >
            Check payment outcome
          </Button>
          {verified?.state === "unknown" || outcome.isError ? (
            <Button
              disabled={mutation.isPending || outcome.isFetching}
              onClick={() =>
                mutation.mutate({
                  kind: "retry",
                  requestKey: attempt.requestKey,
                })
              }
            >
              Retry this same checkout
            </Button>
          ) : null}
          {verified && verified.state !== "paid" && verified.paymentUrl ? (
            <a
              className="underline"
              href={verified.paymentUrl}
              target="_blank"
              rel="noreferrer"
            >
              Continue this checkout with Square
            </a>
          ) : null}
          {verified?.state === "paid" ? (
            <>
              {verified.order ? (
                <>
                  <p>
                    Fulfillment:{" "}
                    {verified.order.fulfillmentState ?? "Not yet available"}.
                    Order status: {verified.order.status ?? "Not yet available"}
                    .
                  </p>
                  <Link
                    className="underline"
                    to={`/orders/${verified.order.id}`}
                  >
                    View this order
                  </Link>
                </>
              ) : (
                <p>
                  Your paid order is being recorded. Check again for its
                  details.
                </p>
              )}
              <Button
                variant="outline"
                onClick={() =>
                  mutation.mutate({
                    kind: "clear",
                    requestKey: attempt.requestKey,
                  })
                }
              >
                Start another checkout
              </Button>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
