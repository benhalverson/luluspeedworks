import { A2uiSurface } from "@a2ui/react/v0_9";
import type { A2uiClientAction } from "@a2ui/web_core/v0_9";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  matchPath,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { AdminWorkspace } from "./admin/workspace";
import type { AgentEffect } from "./storefront/agent-commerce";
import { accountRoute, authClient, returnDestination } from "./storefront/auth";
import { cartActionSchema, useCart } from "./storefront/cart";
import { useCartSessionRecovery } from "./storefront/cart-session";
import { cartView } from "./storefront/cart-view";
import { CheckoutPage } from "./storefront/checkout";
import {
  type Category,
  createCatalogController,
} from "./storefront/controller";
import { OrdersPage } from "./storefront/orders";
import {
  type Configuration,
  configureActionSchema,
  detailView,
  emptyConfiguration,
  parseProductId,
  quantityValid,
  useProduct,
} from "./storefront/product";
import { useCatalog } from "./storefront/queries";
import { RecoveryPage } from "./storefront/recovery";

/** Routes customer checkout, account recovery and the Pit Bench storefront. */
export function App() {
  return (
    <Routes>
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/orders" element={<OrdersPage />} />
      <Route path="/orders/:orderId" element={<OrdersPage />} />
      <Route path="/admin/products" element={<AdminWorkspace />} />
      <Route
        path="/forgot-password"
        element={<RecoveryPage key="forgot" mode="request" />}
      />
      <Route
        path="/reset-password"
        element={<RecoveryPage key="reset" mode="reset" />}
      />
      <Route path="/" element={<Storefront />} />
      <Route path="/products/:productId" element={<Storefront />} />
      <Route path="/signin" element={<Storefront />} />
      <Route path="/signup" element={<Storefront />} />
      <Route path="/profile" element={<Storefront />} />
      <Route path="*" element={<Storefront />} />
    </Routes>
  );
}

/** Own catalog, commerce and agent controllers for this route-mounted storefront. */
function Storefront() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const origin =
    import.meta.env.VITE_API_ORIGIN || "https://api.luluspeedworks.com";
  const { snapshot, status, failed, retry } = useCatalog(origin);
  const { pathname, search } = useLocation();
  const benchPath = accountRoute(pathname)
    ? returnDestination(new URLSearchParams(search).get("returnTo"))
    : pathname;
  const productId = matchPath("/products/:productId", benchPath)?.params
    .productId;
  const id =
    benchPath === "/" || accountRoute(benchPath)
      ? null
      : parseProductId(productId);
  const previousPath = useRef(pathname);
  const selected = useProduct(origin, id);
  const session = authClient.useSession();
  useCartSessionRecovery(origin, session.refetch);
  const bag = useCart(
    origin,
    session.data?.user?.id ?? null,
    !session.isPending && !session.error,
  );
  const [configurations, setConfigurations] = useState<
    Record<number, Configuration>
  >({});
  const config =
    typeof id === "number"
      ? (configurations[id] ?? emptyConfiguration)
      : emptyConfiguration;
  const verifiedColors =
    selected.colors.isSuccess && !selected.colors.isFetching
      ? selected.colors.data
      : undefined;
  useEffect(() => {
    if (typeof id !== "number" || !verifiedColors) return;
    setConfigurations((current) => {
      const saved = current[id];
      if (
        !saved?.color ||
        verifiedColors.data.some((color) => color.publicId === saved.color)
      )
        return current;
      return { ...current, [id]: { ...saved, color: "", unavailable: true } };
    });
  }, [id, verifiedColors]);
  const [category, setCategory] = useState<Category>("all");
  const [page, setPage] = useState(1);
  const [controller, setController] =
    useState<ReturnType<typeof createCatalogController>>();
  const availableColor = verifiedColors?.data.find(
    (color) => color.publicId === config.color,
  );
  const bagView = cartView(
    bag,
    Boolean(
      selected.product.isSuccess &&
        !selected.product.isFetching &&
        availableColor &&
        quantityValid(config.quantity),
    ),
  );
  const agentOwner = useEffectEvent(() =>
    session.isPending || session.error
      ? undefined
      : (session.data?.user?.id ?? null),
  );
  const agentPrepare = useEffectEvent(async (signal: AbortSignal) => {
    if (!bag.cartId) await bag.mutation.mutateAsync({ kind: "initialize" });
    signal.throwIfAborted();
    return {
      ...bag.agentAccess(),
      ...(typeof id === "number" && quantityValid(config.quantity)
        ? {
            selection: {
              productId: id,
              quantity: Number(config.quantity),
              ...(availableColor
                ? { filamentId: availableColor.publicId }
                : {}),
            },
          }
        : {}),
    };
  });
  const agentRefresh = useEffectEvent(async () => {
    await bag.cart.refetch();
  });
  const agentApply = useEffectEvent(async (effects: AgentEffect[]) => {
    for (const effect of effects) {
      if ("accountId" in effect) {
        if (
          effect.kind === "checkout_review" &&
          effect.status === "review_required" &&
          effect.review &&
          effect.review.cartId === bag.cartId
        ) {
          navigate(
            `/checkout?quoteId=${effect.review.quoteId}&cartId=${effect.review.cartId}`,
          );
        } else if (effect.kind === "owned_orders") {
          const first = effect.orders.at(0);
          navigate(
            first && effect.orders.length === 1
              ? `/orders/${first.id}`
              : "/orders",
          );
        } else if (effect.kind === "checkout_attempt") navigate("/checkout");
      } else if (effect.status === "selected") {
        const chosen = effect.selection;
        if (
          chosen.productId !== id ||
          !selected.product.data ||
          chosen.material !== selected.product.data.filamentType ||
          !verifiedColors?.data.some(
            (color) => color.publicId === chosen.filamentId,
          )
        )
          throw Error("Refresh product options before selecting");
        setConfigurations((current) => ({
          ...current,
          [chosen.productId]: {
            color: chosen.filamentId,
            quantity: String(chosen.quantity),
            unavailable: false,
          },
        }));
      }
    }
  });
  const onAction = useEffectEvent(
    (name: string, context: A2uiClientAction["context"]) => {
      if (name === "refresh-bag") {
        bag.mutation.reset();
        void bag.cart.refetch();
      } else if (name === "acknowledge-bag" && !bagView.busy) {
        bag.mutation.mutate({ kind: "acknowledge" });
      } else if (name === "change-bag" && !bagView.busy && !bag.uncertain) {
        const action = cartActionSchema.safeParse(context);
        if (action.success && action.data.kind !== "add")
          bag.mutation.mutate(action.data);
      } else if (name === "add-to-bag") {
        const action = configureActionSchema.safeParse(context);
        if (
          action.success &&
          action.data.productId === id &&
          !bagView.addDisabled &&
          availableColor &&
          selected.product.data
        ) {
          bag.mutation.mutate({
            kind: "add",
            item: {
              skuNumber: selected.product.data.skuNumber,
              quantity: Number(config.quantity),
              color: availableColor.color,
              filamentType: selected.product.data.filamentType,
              filamentId: availableColor.publicId,
            },
          });
        }
      } else if (name === "configure") {
        const result = configureActionSchema.safeParse(context);
        if (
          !result.success ||
          result.data.productId !== id ||
          !selected.product.data
        )
          return;
        const { color, quantity } = result.data;
        if (
          color !== undefined &&
          color !== "" &&
          (!selected.colors.isSuccess ||
            selected.colors.isFetching ||
            !selected.colors.data.data.some(
              (option) => option.publicId === color,
            ))
        )
          return;
        setConfigurations((current) => ({
          ...current,
          [result.data.productId]: {
            ...(current[result.data.productId] ?? emptyConfiguration),
            ...(color !== undefined ? { color, unavailable: false } : {}),
            ...(quantity !== undefined ? { quantity } : {}),
          },
        }));
      } else if (name === "retry-product") void selected.product.refetch();
      else if (name === "retry-colors") void selected.colors.refetch();
      else if (name === "retry") {
        setPage(1);
        void retry();
      } else if (name === "all" || name === "rc" || name === "pit") {
        setCategory(name);
        setPage(1);
      } else if (name === "previous") setPage((page) => page - 1);
      else if (name === "next") setPage((page) => page + 1);
    },
  );
  useEffect(() => {
    const current = createCatalogController(
      client,
      (name, context) => onAction(name, context),
      origin,
      {
        owner: () => agentOwner(),
        prepare: (signal) => agentPrepare(signal),
        refresh: () => agentRefresh(),
        apply: (effects) => agentApply(effects),
      },
    );
    setController(current);
    return () => current.dispose();
  }, [client]);
  useLayoutEffect(() => {
    controller?.identity(
      session.isPending || session.error
        ? undefined
        : (session.data?.user?.id ?? null),
    );
  }, [controller, session.data?.user?.id, session.isPending, session.error]);
  useLayoutEffect(() => {
    controller?.navigate(`${pathname}${search}`);
  }, [controller, pathname, search]);
  useEffect(() => {
    controller?.publish(snapshot, category, page, status, failed);
  }, [controller, snapshot, category, page, status, failed]);
  const detail = detailView(id, selected, config);
  useLayoutEffect(() => {
    controller?.publishCart(bagView);
  }, [controller, bagView]);
  useEffect(() => {
    controller?.publishDetail(detail);
  }, [controller, detail]);
  useEffect(() => {
    if (previousPath.current !== pathname) {
      document.getElementById("focus-title")?.focus();
      previousPath.current = pathname;
    }
  }, [pathname]);
  return controller?.surface ? (
    <A2uiSurface surface={controller.surface} />
  ) : null;
}
