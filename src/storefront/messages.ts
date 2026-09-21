import type { A2uiMessage } from "@a2ui/web_core/v0_9";
import { componentCatalog } from "./catalog";

export const categoryNames = {
  all: "Shop all",
  rc: "RC Parts",
  pit: "Pit Tools",
};

export const wireVersion = "v0.9.1";
export const surfaceId = "storefront";

export const loadingRail = {
  entries: [],
  status: "Loading catalog…",
  paging: "",
  previousDisabled: true,
  nextDisabled: true,
  retryVisible: false,
  all: true,
  rc: false,
  pit: false,
};

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
        rail: loadingRail,
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
        {
          id: "products",
          component: "ProductRail",
          controls: ["category-all", "category-rc", "category-pit"],
          entries: { componentId: "entry", path: "/rail/entries" },
          status: { path: "/rail/status" },
          paging: { path: "/rail/paging" },
          previousDisabled: { path: "/rail/previousDisabled" },
          nextDisabled: { path: "/rail/nextDisabled" },
          retryVisible: { path: "/rail/retryVisible" },
          previous: { event: { name: "previous" } },
          next: { event: { name: "next" } },
          retry: { event: { name: "retry" } },
        },
        ...Object.entries(categoryNames).map(([category, label]) => ({
          id: `category-${category}`,
          component: "CategoryControl",
          label,
          selected: { path: `/rail/${category}` },
          action: { event: { name: category } },
        })),
        {
          id: "entry",
          component: "ProductEntry",
          name: { path: "name" },
          description: { path: "description" },
          image: { path: "image" },
          price: { path: "price" },
        },
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
