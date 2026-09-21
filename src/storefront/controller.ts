import { type A2uiMessage, MessageProcessor } from "@a2ui/web_core/v0_9";
import { type CatalogSnapshot, fetchCatalog } from "./api";
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

export function createCatalogController(origin: string) {
  let snapshot: CatalogSnapshot | undefined;
  let category: Category = "all";
  let page = 1;
  let request: AbortController;
  const processor = new MessageProcessor(
    [componentCatalog],
    (action) => {
      if (action.name === "retry") {
        void load();
        return;
      }
      if (
        action.name === "all" ||
        action.name === "rc" ||
        action.name === "pit"
      ) {
        category = action.name;
        page = 1;
      } else if (action.name === "previous") page--;
      else if (action.name === "next") page++;
      else return;
      publish();
    },
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

  function publish() {
    const selection = {
      all: category === "all",
      rc: category === "rc",
      pit: category === "pit",
    };
    if (!snapshot) {
      update(selection);
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

  async function load() {
    request?.abort();
    const current = new AbortController();
    request = current;
    snapshot = undefined;
    page = 1;
    update({
      ...loadingRail,
      all: category === "all",
      rc: category === "rc",
      pit: category === "pit",
    });
    const result = await fetchCatalog(origin, current.signal);
    if (current.signal.aborted) return;
    if (result.ok) {
      snapshot = result.value;
      publish();
    } else {
      current.abort();
      const status =
        result.kind === "malformed"
          ? "Malformed catalog response. Please retry."
          : result.kind === "timeout"
            ? "Catalog request timed out. Please retry."
            : "Catalog unavailable. Please retry.";
      update({ status, retryVisible: true });
    }
  }
  void load();
  return {
    surface: processor.model.getSurface(surfaceId),
    dispose() {
      request.abort();
      processor.model.dispose();
    },
  };
}
