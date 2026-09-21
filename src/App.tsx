import {
  A2uiSurface,
  type ReactComponentImplementation,
} from "@a2ui/react/v0_9";
import { MessageProcessor, type SurfaceModel } from "@a2ui/web_core/v0_9";
import { useEffect, useState } from "react";
import { componentCatalog } from "./storefront/catalog";
import { initialMessages, surfaceId, wireVersion } from "./storefront/messages";

export function App() {
  const [surface, setSurface] =
    useState<SurfaceModel<ReactComponentImplementation>>();

  useEffect(() => {
    // Each effect setup owns a new processor: Strict Mode can safely replay it.
    const processor = new MessageProcessor([componentCatalog], undefined, {
      version: wireVersion,
    });
    processor.processMessages(initialMessages);
    setSurface(processor.model.getSurface(surfaceId));
    return () => processor.model.dispose();
  }, []);

  return surface ? <A2uiSurface surface={surface} /> : null;
}
