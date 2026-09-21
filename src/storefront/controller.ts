import {
  type A2uiClientAction,
  type A2uiMessage,
  MessageProcessor,
} from "@a2ui/web_core/v0_9";
import type { CatalogSnapshot } from "./api";
import { componentCatalog } from "./catalog";
import {
  categoryNames,
  initialMessages,
  loadingRail,
  surfaceId,
  wireVersion,
} from "./messages";

export type Category = keyof typeof categoryNames;

export function browse(
  snapshot: CatalogSnapshot,
  category: Category,
  page: number,
) {
  const rc = snapshot.categories.filter(
    (item) => item.categoryName.trim().toLowerCase() === "rc parts",
  );
  const pit = snapshot.categories.filter((item) =>
    ["pit tools", "pit stuff"].includes(item.categoryName.trim().toLowerCase()),
  );
  const mappings = category === "all" ? [] : [category === "rc" ? rc : pit];
  const available = mappings.every((mapping) => mapping.length === 1);
  const ids = new Set(mappings.flat().map((item) => item.categoryId));
  const products = available
    ? snapshot.products.filter(
        (product) =>
          category === "all" || product.categoryIds.some((id) => ids.has(id)),
      )
    : [];
  const totalPages = Math.max(1, Math.ceil(products.length / 10));
  const currentPage = Math.max(1, Math.min(page, totalPages));
  return {
    available,
    entries: products.slice((currentPage - 1) * 10, currentPage * 10),
    count: products.length,
    page: currentPage,
    totalPages,
  };
}

const prices = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function createCatalogController(
  onAction: (name: string, context: A2uiClientAction["context"]) => void,
) {
  const processor = new MessageProcessor(
    [componentCatalog],
    (action) => onAction(action.name, action.context),
    { version: wireVersion },
  );
  processor.processMessages(structuredClone(initialMessages));

  function update(
    value: Record<
      string,
      | string
      | boolean
      | {
          name: string;
          description: string;
          image: string;
          price: string;
          href: string;
        }[]
    >,
  ) {
    processor.processMessages([
      ...Object.entries(value).map(
        ([key, value]): A2uiMessage => ({
          version: wireVersion,
          updateDataModel: { surfaceId, path: `/rail/${key}`, value },
        }),
      ),
    ]);
  }

  function publish(
    snapshot: CatalogSnapshot | undefined,
    category: Category,
    page: number,
    status: string,
    failed: boolean,
  ) {
    const selection = {
      all: category === "all",
      rc: category === "rc",
      pit: category === "pit",
    };
    if (!snapshot) {
      update({ ...loadingRail, ...selection, status, retryVisible: failed });
      return;
    }
    const result = browse(snapshot, category, page);
    page = result.page;
    const label = categoryNames[category];
    update({
      ...selection,
      entries: result.entries.map((product) => ({
        href: `/products/${product.id}`,
        name: product.name,
        description: product.description,
        image: product.image,
        price: prices.format(product.price),
      })),
      status: !result.available
        ? `${label} unavailable: required categories are missing or ambiguous.`
        : result.count === 0
          ? `No products in ${label}.`
          : `${label}: ${result.count} products. Page ${page} of ${result.totalPages}.`,
      paging: result.available
        ? `${result.count} results · Page ${page} of ${result.totalPages}`
        : "",
      previousDisabled: page === 1,
      nextDisabled: page === result.totalPages,
      retryVisible: !result.available,
    });
  }

  return {
    surface: processor.model.getSurface(surfaceId),
    publishCart(value: import("./cart-view").CartView) {
      processor.processMessages([
        {
          version: wireVersion,
          updateDataModel: { surfaceId, path: "/cart", value },
        },
      ]);
    },
    publishDetail(value: import("./product").DetailView) {
      processor.processMessages([
        {
          version: wireVersion,
          updateDataModel: { surfaceId, path: "/detail", value },
        },
      ]);
    },
    publish,
    dispose() {
      processor.model.dispose();
    },
  };
}
