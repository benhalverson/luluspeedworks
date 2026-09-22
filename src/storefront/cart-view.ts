import type { useCart } from "./cart";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
export function cartView(state: ReturnType<typeof useCart>, canAdd: boolean) {
  const { cart, mutation, uncertain } = state;
  const busy = cart.isFetching || mutation.isPending;
  const disabled = busy || uncertain || !cart.isSuccess;
  const data = cart.isSuccess ? cart.data : undefined;
  return {
    count: (data?.items ?? []).reduce(
      (total, line) => total + line.quantity,
      0,
    ),
    busy,
    uncertain,
    addDisabled: disabled || !canAdd,
    status: busy
      ? "Updating bag…"
      : (mutation.error?.message ??
        (cart.isError
          ? "Bag unavailable. Refresh to recover your saved bag."
          : uncertain
            ? "A previous change has an unknown outcome."
            : data?.items.length
              ? "Bag updated."
              : "Your bag is empty.")),
    total: data ? money.format(data.total) : "",
    lines: (data?.items ?? []).map((line) => ({
      itemId: line.id,
      name: line.name ?? `Unavailable item (${line.productId})`,
      description: `${line.color} · ${line.filamentType} · SKU ${line.productId}`,
      price:
        line.price === null ? "Price unavailable" : money.format(line.price),
      quantity: line.quantity,
      unavailable: line.name === null || line.price === null,
      disabled,
    })),
  };
}
export type CartView = ReturnType<typeof cartView>;
