import type { A2uiMessage } from "@a2ui/web_core/v0_9";
import { componentCatalog } from "./catalog";

export const wireVersion = "v0.9.1";
export const surfaceId = "storefront";

export const initialMessages: A2uiMessage[] = [
  {
    version: wireVersion,
    createSurface: { surfaceId, catalogId: componentCatalog.id },
  },
  {
    version: wireVersion,
    updateDataModel: {
      surfaceId,
      path: "/",
      value: {
        title: "Your bench awaits.",
        description: "No product selected. There’s room for your next project.",
      },
    },
  },
  {
    version: wireVersion,
    updateComponents: {
      surfaceId,
      components: [
        {
          id: "root",
          component: "PitBench",
          header: "header",
          products: "products",
          focus: "focus",
          configuration: "configuration",
          composer: "composer",
        },
        { id: "header", component: "BrandHeader" },
        { id: "products", component: "ProductRail" },
        {
          id: "focus",
          component: "ProductFocus",
          title: { path: "/title" },
          description: { path: "/description" },
        },
        { id: "configuration", component: "Configuration" },
        { id: "composer", component: "ShoppingComposer" },
      ],
    },
  },
];
