import { type A2uiMessage, MessageProcessor } from "@a2ui/web_core/v0_9";
import type { CatalogSnapshot } from "./api";
import { browse, type Category, categoryNames } from "./browse";
import { componentCatalog } from "./catalog";
import {
  initialMessages,
  loadingRail,
  surfaceId,
  wireVersion,
} from "./messages";

const prices = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function createCatalogController(onAction: (name: string) => void) {
  const processor = new MessageProcessor(
    [componentCatalog],
    (action) => onAction(action.name),
    { version: wireVersion },
  );
  processor.processMessages(structuredClone(initialMessages));

  function update(
    value: Record<
      string,
      | string
      | boolean
      | { name: string; description: string; image: string; price: string }[]
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
    publish,
    dispose() {
      processor.model.dispose();
    },
  };
}
