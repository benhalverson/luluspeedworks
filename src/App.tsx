import { A2uiSurface } from "@a2ui/react/v0_9";
import type { A2uiClientAction } from "@a2ui/web_core/v0_9";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Route, Routes, useLocation, useParams } from "react-router";
import { authClient } from "./storefront/auth";
import { cartActionSchema, useCart } from "./storefront/cart";
import { cartView } from "./storefront/cart-view";
import {
  type Category,
  createCatalogController,
} from "./storefront/controller";
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

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Storefront />} />
      <Route path="/products/:productId" element={<Storefront />} />
      <Route path="/signin" element={<Storefront />} />
      <Route path="/signup" element={<Storefront />} />
      <Route path="/profile" element={<Storefront />} />
      <Route path="/orders" element={<Storefront />} />
      <Route path="/orders/:orderId" element={<Storefront />} />
      <Route path="*" element={<Storefront />} />
    </Routes>
  );
}

function Storefront() {
  const origin =
    import.meta.env.VITE_API_ORIGIN || "https://api.benhalverson.dev";
  const { snapshot, status, failed, retry } = useCatalog(origin);
  const { pathname } = useLocation();
  const { productId } = useParams();
  const id =
    ["/", "/signin", "/signup", "/profile", "/orders"].includes(pathname) ||
    pathname.startsWith("/orders/")
      ? null
      : parseProductId(productId);
  const previousPath = useRef(pathname);
  const selected = useProduct(origin, id);
  const session = authClient.useSession();
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
    const current = createCatalogController((name, context) =>
      onAction(name, context),
    );
    setController(current);
    return () => current.dispose();
  }, []);
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
