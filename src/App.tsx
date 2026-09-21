import { A2uiSurface } from "@a2ui/react/v0_9";
import type { A2uiClientAction } from "@a2ui/web_core/v0_9";
import { useEffect, useEffectEvent, useState } from "react";
import {
  type Category,
  createCatalogController,
} from "./storefront/controller";
import { useProductNavigation } from "./storefront/navigation";
import {
  type Configuration,
  configureActionSchema,
  detailView,
  emptyConfiguration,
  productRoute,
  useProduct,
} from "./storefront/product";
import { useCatalog } from "./storefront/queries";

export function App() {
  const origin =
    import.meta.env.VITE_API_ORIGIN || "https://api.benhalverson.dev";
  const { snapshot, status, failed, retry } = useCatalog(origin);
  const id = productRoute(useProductNavigation());
  const selected = useProduct(origin, id);
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
  const onAction = useEffectEvent(
    (name: string, context: A2uiClientAction["context"]) => {
      if (name === "configure") {
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
  useEffect(() => {
    controller?.publishDetail(detail);
  }, [controller, detail]);
  return controller?.surface ? (
    <A2uiSurface surface={controller.surface} />
  ) : null;
}
