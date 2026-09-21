import type { A2uiMessage } from "@a2ui/web_core/v0_9";
import { componentCatalog } from "./catalog";
import { emptyDetail } from "./product";

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
        detail: emptyDetail,
        cart: {
          lines: [],
          status: "Loading bag…",
          total: "",
          busy: true,
          uncertain: false,
          addDisabled: true,
        },
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
          cart: "bag",
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
          href: { path: "href" },
        },
        {
          id: "focus",
          component: "ProductFocus",
          title: { path: "/title" },
          description: { path: "/description" },
          selectedTitle: { path: "/detail/title" },
          selectedDescription: { path: "/detail/description" },
          active: { path: "/detail/active" },
          ready: { path: "/detail/ready" },
          price: { path: "/detail/price" },
          sku: { path: "/detail/sku" },
          compatibility: { path: "/detail/compatibility" },
          images: { componentId: "detail-image", path: "/detail/images" },
          retryVisible: { path: "/detail/retryVisible" },
          retry: { event: { name: "retry-product" } },
        },
        {
          id: "detail-image",
          component: "DetailImage",
          src: { path: "src" },
          name: { path: "name" },
        },
        {
          id: "color-option",
          component: "ColorOption",
          value: { path: "value" },
          label: { path: "label" },
        },
        {
          id: "configuration",
          component: "Configuration",
          productId: { path: "/detail/productId" },
          material: { path: "/detail/material" },
          ready: { path: "/detail/ready" },
          colorsReady: { path: "/detail/colorsReady" },
          colors: { componentId: "color-option", path: "/detail/colors" },
          color: { path: "/detail/color" },
          quantity: { path: "/detail/quantity" },
          quantityError: { path: "/detail/quantityError" },
          addDisabled: { path: "/cart/addDisabled" },
          colorStatus: { path: "/detail/colorStatus" },
          retryVisible: { path: "/detail/colorsRetry" },
          retry: { event: { name: "retry-colors" } },
        },
        { id: "composer", component: "ShoppingComposer" },
        {
          id: "bag",
          component: "CartPanel",
          lines: { componentId: "bag-line", path: "/cart/lines" },
          status: { path: "/cart/status" },
          total: { path: "/cart/total" },
          busy: { path: "/cart/busy" },
          uncertain: { path: "/cart/uncertain" },
        },
        {
          id: "bag-line",
          component: "CartLine",
          itemId: { path: "itemId" },
          name: { path: "name" },
          description: { path: "description" },
          quantity: { path: "quantity" },
          price: { path: "price" },
          disabled: { path: "disabled" },
          unavailable: { path: "unavailable" },
        },
      ],
    },
  },
];
