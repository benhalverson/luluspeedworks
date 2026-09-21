import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router";
import { z } from "zod";
import { Button } from "../components/ui/button";
import { imageUrl as safeHttpUrl } from "./api";
import { apiOrigin, authClient } from "./auth";

const orderSchema = z.object({
  id: z.number().int().positive(),
  orderNumber: z.string().min(1),
  createdAt: z.string().nullable(),
  status: z.string().nullable(),
  slantStatus: z.string().nullable(),
  totalAmountCents: z.number().int().nonnegative().nullable(),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .nullable(),
  items: z.array(
    z.object({
      name: z.string().nullable(),
      quantity: z.number().int().nonnegative(),
      color: z.string().nullable(),
      filamentType: z.string().nullable(),
    }),
  ),
  fulfillment: z.object({
    trackingNumber: z.string().nullable(),
    trackingUrl: z.string().nullable(),
    carrier: z.string().nullable(),
    estimatedArrival: z.string().nullable(),
    shippedAt: z.string().nullable(),
    deliveredAt: z.string().nullable(),
  }),
  cancellation: z.object({ canceledAt: z.string().nullable() }).nullable(),
});
type Order = z.infer<typeof orderSchema>;
const limit = 10;
const pageSchema = z.object({
  orders: z.array(orderSchema).max(limit),
  pagination: z.object({
    limit: z.literal(limit),
    offset: z.number().int().nonnegative(),
    count: z.number().int().nonnegative(),
  }),
});

function total(order: Order) {
  return order.totalAmountCents !== null && order.currency !== null
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: order.currency,
      }).format(order.totalAmountCents / 100)
    : "Total unavailable";
}

function OrderDetail({ order }: { order: Order }) {
  const trackingUrl = safeHttpUrl(order.fulfillment.trackingUrl);
  return (
    <article className="grid gap-3">
      <h3 className="font-display text-2xl">Order {order.orderNumber}</h3>
      <p>{total(order)}</p>
      <p>Placed: {order.createdAt ?? "Date unavailable"}</p>
      <p>Order status: {order.status ?? "Unavailable"}</p>
      <p>Payment status unavailable from the current order record.</p>
      <p>Fulfillment: {order.slantStatus ?? "Status unavailable"}</p>
      <ul className="grid gap-2">
        {order.items.map((item) => (
          <li key={JSON.stringify(item)}>
            {item.quantity} × {item.name ?? "Item unavailable"} —{" "}
            {item.color ?? "Color unavailable"},{" "}
            {item.filamentType ?? "Material unavailable"}
          </li>
        ))}
      </ul>
      <p>Tracking: {order.fulfillment.trackingNumber ?? "Not available"}</p>
      <p>Carrier: {order.fulfillment.carrier ?? "Not available"}</p>
      <p>
        Estimated arrival:{" "}
        {order.fulfillment.estimatedArrival ?? "Not available"}
      </p>
      <p>Shipped: {order.fulfillment.shippedAt ?? "Not available"}</p>
      <p>Delivered: {order.fulfillment.deliveredAt ?? "Not available"}</p>
      {trackingUrl ? (
        <a
          className="underline"
          href={trackingUrl}
          target="_blank"
          rel="noreferrer"
        >
          Track shipment
        </a>
      ) : null}
      {order.cancellation ? (
        <p>
          Cancellation recorded:{" "}
          {order.cancellation.canceledAt ?? "Date unavailable"}. Refund status
          unavailable.
        </p>
      ) : null}
      <Link className="underline" to="/orders">
        Back to orders
      </Link>
    </article>
  );
}

export function OrdersPanel({ userId }: { userId: string }) {
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const rawOffset = params.get("offset") ?? "0";
  const offset =
    /^\d+$/.test(rawOffset) && Number.isSafeInteger(Number(rawOffset))
      ? Number(rawOffset)
      : 0;
  const detail = pathname !== "/orders";
  const id = pathname.slice("/orders/".length);
  const valid =
    !detail || (/^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)));
  const orders = useQuery({
    queryKey: ["orders", apiOrigin, userId, pathname, offset],
    enabled: valid,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const response = await authClient.$fetch(
        detail
          ? `/orders/${id}`
          : `/orders?limit=${limit}&offset=${offset}&direction=desc`,
        {
          baseURL: apiOrigin,
          credentials: "include",
          cache: "no-store",
          jsonParser: JSON.parse,
          retry: 0,
          signal,
        },
      );
      if (response.error) throw new Error("Orders unavailable");
      return detail
        ? orderSchema
            .refine((order) => order.id === Number(id))
            .parse(response.data)
        : pageSchema
            .refine((page) => page.pagination.offset === offset)
            .refine(
              (page) =>
                page.orders.length ===
                Math.min(limit, Math.max(0, page.pagination.count - offset)),
            )
            .parse(response.data);
    },
  });
  if (!valid) return <p role="alert">Invalid order link.</p>;
  if (orders.isError)
    return (
      <div className="grid gap-3">
        <p role="alert">
          Orders unavailable. Sign in again if your session expired, or retry.
        </p>
        <Button variant="outline" onClick={() => void orders.refetch()}>
          Retry orders
        </Button>
      </div>
    );
  if (orders.isPending || orders.isFetching)
    return <p role="status">Loading your orders…</p>;
  if (!("orders" in orders.data)) return <OrderDetail order={orders.data} />;
  const page = orders.data;
  return (
    <section aria-label="Order history" className="mt-5 grid gap-4">
      <h2 className="font-display text-2xl">Your orders</h2>
      {page.orders.length === 0 ? (
        <p>No orders on this page.</p>
      ) : (
        <ul className="grid gap-3">
          {page.orders.map((order) => (
            <li key={order.id} className="rounded border border-border p-3">
              <Link className="underline" to={`/orders/${order.id}`}>
                Order {order.orderNumber}
              </Link>
              <p>{total(order)}</p>
              <p>Order status: {order.status ?? "Unavailable"}</p>
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="Order pages" className="flex gap-3">
        <Button
          variant="outline"
          disabled={offset === 0}
          onClick={() =>
            setParams({ offset: String(Math.max(0, offset - limit)) })
          }
        >
          Previous orders
        </Button>
        <Button
          variant="outline"
          disabled={offset + limit >= page.pagination.count}
          onClick={() => setParams({ offset: String(offset + limit) })}
        >
          Next orders
        </Button>
      </nav>
    </section>
  );
}
