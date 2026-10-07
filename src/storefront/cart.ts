import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useEventListener, useLocalStorage } from "usehooks-ts";
import { z } from "zod";

const uuid = z.string().uuid();
const quantity = z.number().int().min(1).max(69);
export const cartSchema = z
  .object({
    items: z.array(
      z.object({
        id: z.number().int().positive(),
        // The API's productId field contains the SKU, not the catalog product ID.
        productId: z.string().min(1),
        quantity,
        color: z.string().min(1),
        filamentType: z.string().min(1),
        filamentId: uuid,
        name: z.string().nullable(),
        price: z.number().finite().nonnegative().nullable(),
      }),
    ),
    total: z.number().finite().nonnegative(),
  })
  .refine(
    ({ items }) => new Set(items.map((line) => line.id)).size === items.length,
  );
export const addCartItemSchema = z.object({
  skuNumber: z.string().min(1),
  quantity,
  color: z.string().min(1),
  filamentType: z.enum(["PLA", "PETG", "ABS"]),
  filamentId: uuid,
});
export const cartActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add"), item: addCartItemSchema }),
  z.object({
    kind: z.literal("update"),
    itemId: z.number().int().positive(),
    quantity,
  }),
  z.object({ kind: z.literal("remove"), itemId: z.number().int().positive() }),
]);
const savedCartSchema = z
  .object({
    cartId: uuid,
    guestToken: uuid.optional(),
    ownerId: z.string().nullable().default(null),
    pending: z.boolean(),
    revision: uuid,
  })
  .nullable();
type SavedCart = z.infer<typeof savedCartSchema>;
type CartOperation =
  | CartAction
  | { kind: "initialize" }
  | { kind: "acknowledge" }
  | { kind: "claim"; userId: string };
export type CartAction = z.infer<typeof cartActionSchema>;
export type CartSnapshot = z.infer<typeof cartSchema>;
const empty: CartSnapshot = { items: [], total: 0 };
/** Validate persisted browser hints; the API remains the authority for ownership. */
const deserialize = (value: string) => savedCartSchema.parse(JSON.parse(value));

/** Make a private request, broadcasting authorization loss to pending cart operations. */
async function request<T>(
  origin: string,
  path: string,
  schema: z.ZodType<T>,
  method = "GET",
  body?: object,
  signal?: AbortSignal,
  guestToken?: string,
) {
  const response = await fetch(new URL(path, origin), {
    method,
    credentials: "include",
    cache: "no-store",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(guestToken ? { "X-Cart-Token": guestToken } : {}),
    },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
      : AbortSignal.timeout(10_000),
    ...(body
      ? {
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 404
  )
    window.dispatchEvent(new Event(`lulu-cart-denied:${origin}`));
  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 404
  )
    window.dispatchEvent(new Event(`lulu-cart-expired:${origin}`));
  if (!response.ok)
    throw new Error(
      `Bag request failed (${response.status}). Refresh to check your bag.`,
    );
  return schema.parse(await response.json());
}

/** Owns account-scoped cart operations and exposes the durable quote-review revision. */
export function useCart(
  origin: string,
  identity: string | null = null,
  ready = true,
) {
  const client = useQueryClient();
  const owner = useRef({
    identity,
    ready,
    version: 0,
    visit: 0,
    denied: 0,
    interrupted: 0,
  });
  if (owner.current.identity !== identity) owner.current.version += 1;
  owner.current.identity = identity;
  if (owner.current.ready && !ready) owner.current.interrupted += 1;
  owner.current.ready = ready;
  useEffect(() => {
    owner.current.visit += 1;
    return () => {
      owner.current.visit += 1;
    };
  }, []);
  useEffect(() => {
    /** Invalidate pending operations in every mounted cart consumer on denial. */
    function deny() {
      owner.current.denied += 1;
    }
    window.addEventListener(`lulu-cart-denied:${origin}`, deny);
    return () => window.removeEventListener(`lulu-cart-denied:${origin}`, deny);
  }, [origin]);
  const storageKey = `lulu-cart-v2:${origin}`;
  const queryKey = ["cart", origin, identity];
  const [stored, setSaved] = useLocalStorage<SavedCart>(storageKey, null, {
    deserializer: deserialize,
  });
  const [archived] = useLocalStorage<SavedCart>(
    `${storageKey}:owner:${identity}`,
    null,
    {
      deserializer: deserialize,
    },
  );
  const saved =
    stored && (stored.ownerId === null || stored.ownerId === identity)
      ? stored
      : archived?.ownerId === identity
        ? archived
        : null;
  /** Re-read durable state after acquiring the cross-tab lock. */
  function readSaved(owner = identity) {
    const value = deserialize(localStorage.getItem(storageKey) ?? "null");
    if (value && (value.ownerId === null || value.ownerId === owner))
      return value;
    const archived = deserialize(
      localStorage.getItem(`${storageKey}:owner:${owner}`) ?? "null",
    );
    return archived?.ownerId === owner ? archived : null;
  }
  /** Refuse mutations when the uncertainty marker cannot be durably stored. */
  function persist(value: Exclude<SavedCart, null>) {
    const previous = deserialize(localStorage.getItem(storageKey) ?? "null");
    // Keep each account's pointer before another account or a guest starts shopping.
    if (previous?.ownerId)
      localStorage.setItem(
        `${storageKey}:owner:${previous.ownerId}`,
        JSON.stringify(previous),
      );
    setSaved(value);
    // useLocalStorage reports storage failures by logging. Do not send a write
    // unless the durable marker really was saved, including in private mode.
    if (
      deserialize(localStorage.getItem(storageKey) ?? "null")?.revision !==
      value.revision
    )
      throw new Error(
        "Bag storage unavailable. Enable browser storage before shopping.",
      );
  }
  const cart = useQuery({
    enabled: ready,
    queryKey: [...queryKey, ready, saved?.cartId, saved?.revision],
    /** Discard responses that outlive a concurrent authorization denial. */
    queryFn: async ({ signal }) => {
      const denied = owner.current.denied;
      const result = saved
        ? await request(
            origin,
            `/cart/${saved.cartId}`,
            cartSchema,
            "GET",
            undefined,
            signal,
            saved.guestToken,
          )
        : empty;
      if (denied !== owner.current.denied)
        throw new Error(
          "Your session changed. Refresh your bag before continuing.",
        );
      return result;
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  useEventListener("storage", (event) => {
    if (event.key === storageKey || event.key === null)
      void client.invalidateQueries({ queryKey });
  });
  const mutation = useMutation({
    mutationKey: queryKey,
    scope: { id: storageKey },
    retry: false,
    networkMode: "always",
    /** Serialize durable cart writes while retaining their enqueue-time ownership. */
    mutationFn: async ({
      input,
      started,
    }: {
      input: CartOperation;
      started: typeof owner.current;
    }) => {
      /** Reject obsolete visits/accounts and successes following an authorization denial. */
      function assertOwner() {
        const latest = owner.current;
        const claimTransition =
          input.kind === "claim" &&
          started.identity === null &&
          latest.identity === input.userId &&
          latest.version === started.version + 1;
        if (
          latest.visit !== started.visit ||
          latest.denied !== started.denied ||
          (latest.version !== started.version && !claimTransition) ||
          (input.kind !== "claim" &&
            (latest.identity !== identity ||
              latest.interrupted !== started.interrupted)) ||
          (input.kind === "claim" &&
            latest.identity !== null &&
            latest.identity !== input.userId)
        )
          throw new Error(
            "Your session changed. Refresh your bag before continuing.",
          );
        if (input.kind !== "claim" && !latest.ready)
          throw new Error("Wait for your session to finish loading.");
      }
      assertOwner();
      // Login has already verified its session before requesting a claim. The
      // reactive session hook can still be refreshing at that point; the claim
      // endpoint validates the session cookie and guest capability itself.
      // Reads and item edits remain gated on the reactive session state.
      if (input.kind === "claim" && !readSaved(input.userId)?.guestToken)
        return empty;
      if (!navigator.locks)
        throw new Error(
          "Shopping requires a browser with secure cross-tab locks.",
        );
      return navigator.locks.request(storageKey, async () => {
        assertOwner();
        await client.cancelQueries({ queryKey });
        assertOwner();
        let current = readSaved(
          input.kind === "claim" ? input.userId : identity,
        );
        if (input.kind === "claim") {
          if (!current?.guestToken) return empty;
          // Bind an uncertain claim to this account before sending it. Another
          // account must never retry this capability after an interrupted login.
          current = {
            ...current,
            ownerId: input.userId,
            revision: crypto.randomUUID(),
          };
          persist(current);
          await request(
            origin,
            `/cart/${current.cartId}/claim`,
            z.object({ message: z.string(), ownerId: z.literal(input.userId) }),
            "POST",
            { expectedUserId: input.userId },
            undefined,
            current.guestToken,
          );
          assertOwner();
          persist({
            ...current,
            guestToken: undefined,
            revision: crypto.randomUUID(),
          });
          return empty;
        }
        if (input.kind === "acknowledge") {
          if (!current) return empty;
          const checked = await request(
            origin,
            `/cart/${current.cartId}`,
            cartSchema,
            "GET",
            undefined,
            undefined,
            current.guestToken,
          );
          assertOwner();
          persist({
            ...current,
            pending: false,
            revision: crypto.randomUUID(),
          });
          return checked;
        }
        const action =
          input.kind === "initialize" ? input : cartActionSchema.parse(input);
        if (current?.pending)
          throw new Error(
            "A previous change has an unknown outcome. Refresh and check your bag before continuing.",
          );
        if (!current) {
          if (action.kind !== "add" && action.kind !== "initialize")
            throw new Error(
              "This bag is no longer available. Refresh your bag.",
            );
          const created = await request(
            origin,
            "/cart/create",
            z
              .object({
                cartId: uuid,
                guestToken: uuid.optional(),
                ownerId: z.literal(identity),
              })
              .refine(
                (value) => identity !== null || Boolean(value.guestToken),
              ),
            "POST",
            { expectedUserId: identity },
          );
          assertOwner();
          current = {
            cartId: created.cartId,
            guestToken: created.guestToken,
            ownerId: created.ownerId,
            pending: false,
            revision: crypto.randomUUID(),
          };
          persist(current);
        }
        if (action.kind === "initialize") return empty;
        const before = await request(
          origin,
          `/cart/${current.cartId}`,
          cartSchema,
          "GET",
          undefined,
          undefined,
          current.guestToken,
        );
        assertOwner();
        if (
          action.kind !== "add" &&
          !before.items.some((line) => line.id === action.itemId)
        )
          throw new Error(
            "This line is no longer in your bag. Refresh your bag.",
          );
        if (action.kind === "add") {
          const existing = before.items.find(
            (line) =>
              line.productId === action.item.skuNumber &&
              line.filamentId === action.item.filamentId,
          );
          if (existing && existing.quantity + action.item.quantity > 69)
            throw new Error("A bag line can contain at most 69 items.");
        }
        persist({ ...current, pending: true, revision: crypto.randomUUID() });
        const body =
          action.kind === "add"
            ? { cartId: current.cartId, ...action.item }
            : action.kind === "update"
              ? {
                  cartId: current.cartId,
                  itemId: action.itemId,
                  quantity: action.quantity,
                }
              : { cartId: current.cartId, itemId: action.itemId };
        await request(
          origin,
          `/cart/${action.kind}`,
          z.object({ message: z.string() }),
          action.kind === "add"
            ? "POST"
            : action.kind === "update"
              ? "PUT"
              : "DELETE",
          body,
          undefined,
          current.guestToken,
        );
        assertOwner();
        const after = await request(
          origin,
          `/cart/${current.cartId}`,
          cartSchema,
          "GET",
          undefined,
          undefined,
          current.guestToken,
        );
        assertOwner();
        persist({ ...current, pending: false, revision: crypto.randomUUID() });
        return after;
      });
    },
    onSettled: () => client.invalidateQueries({ queryKey }),
  });
  return {
    cart,
    mutation: {
      ...mutation,
      /** Capture ownership when queued, before another mutation can delay execution. */
      mutate(input: CartOperation) {
        mutation.mutate({ input, started: { ...owner.current } });
      },
      /** Preserve the enqueue-time owner while exposing completion to account handoff. */
      mutateAsync(input: CartOperation) {
        return mutation.mutateAsync({ input, started: { ...owner.current } });
      },
    },
    uncertain: saved?.pending === true,
    cartId: saved?.cartId,
    revision: saved?.revision,
    claimable: Boolean(saved?.guestToken && identity !== null),
    /** Return only this hook's current verified capability for trusted agent transport. */
    agentAccess() {
      if (!owner.current.ready || owner.current.identity !== identity)
        throw Error("Shopping account changed");
      const current = readSaved();
      if (
        !current ||
        current.pending ||
        (identity !== null && current.guestToken)
      )
        throw Error("Confirm your bag before shopping guidance");
      return {
        accountId: identity,
        cartId: current.cartId,
        ...(current.guestToken ? { guestToken: current.guestToken } : {}),
      };
    },
  };
}
