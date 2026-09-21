import { A2uiSurface } from "@a2ui/react/v0_9";
import { useEffect, useEffectEvent, useState } from "react";
import {
  type Category,
  createCatalogController,
} from "./storefront/controller";
import { useCatalog } from "./storefront/queries";

export function App() {
  const origin =
    import.meta.env.VITE_API_ORIGIN || "https://api.benhalverson.dev";
  const { snapshot, status, failed, retry } = useCatalog(origin);
  const [category, setCategory] = useState<Category>("all");
  const [page, setPage] = useState(1);
  const [controller, setController] =
    useState<ReturnType<typeof createCatalogController>>();
  const onAction = useEffectEvent((name: string) => {
    if (name === "retry") {
      setPage(1);
      void retry();
    } else if (name === "all" || name === "rc" || name === "pit") {
      setCategory(name);
      setPage(1);
    } else if (name === "previous") setPage((page) => page - 1);
    else if (name === "next") setPage((page) => page + 1);
  });
  useEffect(() => {
    const current = createCatalogController((name) => onAction(name));
    setController(current);
    return () => current.dispose();
  }, []);
  useEffect(() => {
    controller?.publish(snapshot, category, page, status, failed);
  }, [controller, snapshot, category, page, status, failed]);
  return controller?.surface ? (
    <A2uiSurface surface={controller.surface} />
  ) : null;
}
