import {
  A2uiSurface,
  type ReactComponentImplementation,
} from "@a2ui/react/v0_9";
import type { SurfaceModel } from "@a2ui/web_core/v0_9";
import { useEffect, useState } from "react";
import { createCatalogController } from "./storefront/controller";

export function App() {
  const [surface, setSurface] =
    useState<SurfaceModel<ReactComponentImplementation>>();

  useEffect(() => {
    // Each effect setup owns a new processor: Strict Mode can safely replay it.
    const controller = createCatalogController(
      import.meta.env.VITE_API_ORIGIN || "https://api.benhalverson.dev",
    );
    setSurface(controller.surface);
    return () => controller.dispose();
  }, []);

  return surface ? <A2uiSurface surface={surface} /> : null;
}
