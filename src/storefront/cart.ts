import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
    pending: z.boolean(),
    revision: uuid,
  })
  .nullable();
type SavedCart = z.infer<typeof savedCartSchema>;
export type CartAction = z.infer<typeof cartActionSchema>;
export type CartSnapshot = z.infer<typeof cartSchema>;
const empty: CartSnapshot = { items: [], total: 0 };
const deserialize = (value: string) => savedCartSchema.parse(JSON.parse(value));

async function request<T>(
  origin: string,
  path: string,
  schema: z.ZodType<T>,
  method = "GET",
  body?: object,
  signal?: AbortSignal,
) {
  const response = await fetch(new URL(path, origin), {
    method,
    credentials: "include",
    cache: "no-store",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
      : AbortSignal.timeout(10_000),
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok)
    throw new Error(
      `Bag request failed (${response.status}). Refresh to check your bag.`,
    );
  return schema.parse(await response.json());
}

export function useCart(origin: string) {
  const client = useQueryClient();
  const storageKey = `lulu-cart-v1:${origin}`;
  const queryKey = ["cart", origin];
  const [saved, setSaved] = useLocalStorage<SavedCart>(storageKey, null, {
    deserializer: deserialize,
  });
  // Re-read inside the cross-tab lock: a hook render may predate another tab's write.
  function readSaved() {
    return deserialize(localStorage.getItem(storageKey) ?? "null");
  }
  function persist(value: Exclude<SavedCart, null>) {
    setSaved(value);
    // useLocalStorage reports storage failures by logging. Do not send a write
    // unless the durable marker really was saved, including in private mode.
    if (readSaved()?.revision !== value.revision)
      throw new Error(
        "Bag storage unavailable. Enable browser storage before shopping.",
      );
  }
  const cart = useQuery({
    queryKey: [...queryKey, saved?.cartId, saved?.revision],
    queryFn: ({ signal }) =>
      saved
        ? request(
            origin,
            `/cart/${saved.cartId}`,
            cartSchema,
            "GET",
            undefined,
            signal,
          )
        : empty,
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
    mutationFn: async (input: CartAction | { kind: "acknowledge" }) => {
      if (!navigator.locks)
        throw new Error(
          "Shopping requires a browser with secure cross-tab locks.",
        );
      return navigator.locks.request(storageKey, async () => {
        await client.cancelQueries({ queryKey });
        let current = readSaved();
        if (input.kind === "acknowledge") {
          if (!current) return empty;
          const checked = await request(
            origin,
            `/cart/${current.cartId}`,
            cartSchema,
          );
          persist({
            ...current,
            pending: false,
            revision: crypto.randomUUID(),
          });
          return checked;
        }
        const action = cartActionSchema.parse(input);
        if (current?.pending)
          throw new Error(
            "A previous change has an unknown outcome. Refresh and check your bag before continuing.",
          );
        if (!current) {
          if (action.kind !== "add")
            throw new Error(
              "This bag is no longer available. Refresh your bag.",
            );
          const created = await request(
            origin,
            "/cart/create",
            z.object({ cartId: uuid }),
            "POST",
          );
          current = {
            cartId: created.cartId,
            pending: false,
            revision: crypto.randomUUID(),
          };
          persist(current);
        }
        const before = await request(
          origin,
          `/cart/${current.cartId}`,
          cartSchema,
        );
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
        );
        const after = await request(
          origin,
          `/cart/${current.cartId}`,
          cartSchema,
        );
        persist({ ...current, pending: false, revision: crypto.randomUUID() });
        return after;
      });
    },
    onSettled: () => client.invalidateQueries({ queryKey }),
  });
  return { cart, mutation, uncertain: saved?.pending === true };
}
