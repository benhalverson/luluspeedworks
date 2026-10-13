import type { z } from "zod";
import type { bindingBatchSchema } from "../src/storefront/agent-bindings";
import { agentFixture } from "./agent-fixtures";

export const unknownFit =
  "Compatibility is not supplied by this catalog. Verify fit before purchasing.";

// Controlled contract corpus from API companion 205e591, never production products.
export const bindingProducts = [
  "Tool holder",
  "Pit stand",
  "1/10 motor fan mount",
  "Mugen MBX8 1/8 fan mount",
  "Team Associated B6.4 or B7 fan shroud",
].map((name, index) => ({
  id: 101 + index,
  name,
  description: `Controlled fixture: ${name}.`,
  image: "",
  price: `$${10 + index}.00`,
  sku: `FIXTURE-${index}`,
  href: `/products/${101 + index}`,
  compatibility: unknownFit,
}));
type BoundBatch = z.input<typeof bindingBatchSchema>;
export function bindingFixture(
  ids = [101],
  focus: number | null = 101,
): BoundBatch {
  const path = (id: number, field: string) => ({
    path: `/agentCatalog/products/${id}/${field}`,
  });
  const records = [...new Set([...ids, ...(focus === null ? [] : [focus])])];
  const products = Object.fromEntries(
    records.map((id) => {
      const product = bindingProducts.find((item) => item.id === id);
      if (!product) throw Error("Unknown fixture product");
      return [id, { ...product }];
    }),
  );
  return {
    runId: agentFixture.runId,
    uiRevision: agentFixture.uiRevision,
    catalogId: "https://luluspeedworks.com/catalog/scaffold/v1",
    limitations: [...agentFixture.limitations],
    messages: [
      {
        version: "v0.9.1",
        updateDataModel: {
          surfaceId: "storefront",
          path: "/agentCatalog",
          value: { products },
        },
      },
      {
        version: "v0.9.1",
        updateComponents: {
          surfaceId: "storefront",
          components: [
            {
              id: "products",
              component: "ProductRail",
              controls: [],
              entries: ids.map((id) => `agent-item-${id}`),
              status: agentFixture.limitations[0] ?? "",
              paging: "",
              previousDisabled: true,
              nextDisabled: true,
              retryVisible: false,
              previous: { event: { name: "previous" } },
              next: { event: { name: "next" } },
              retry: { event: { name: "retry" } },
            },
            ...ids.map((id) => ({
              id: `agent-item-${id}`,
              component: "ProductEntry" as const,
              name: path(id, "name"),
              description: path(id, "description"),
              image: path(id, "image"),
              price: path(id, "price"),
              href: path(id, "href"),
            })),
            {
              id: "focus",
              component: "ProductFocus",
              title: "Catalog guidance",
              description: agentFixture.limitations[0] ?? "",
              selectedTitle: focus === null ? "" : path(focus, "name"),
              selectedDescription:
                focus === null ? "" : path(focus, "description"),
              href: focus === null ? "" : path(focus, "href"),
              active: focus !== null,
              ready: focus !== null,
              price: focus === null ? "" : path(focus, "price"),
              sku: focus === null ? "" : path(focus, "sku"),
              compatibility:
                focus === null ? unknownFit : path(focus, "compatibility"),
              images: focus === null ? [] : ["agent-photo"],
              retryVisible: false,
              retry: { event: { name: "retry-product" } },
            },
            ...(focus === null
              ? []
              : [
                  {
                    id: "agent-photo",
                    component: "DetailImage" as const,
                    src: path(focus, "image"),
                    name: path(focus, "name"),
                  },
                ]),
          ],
        },
      },
    ],
  };
}

/** Controlled AG-UI frames matching the companion emitter, without backend execution. */
export function bindingStream(
  input: { runId: string; uiRevision: number },
  batch: unknown,
  sessionId = "73f4ebed-0967-4112-8484-ed0263749e61",
) {
  return [
    {
      type: "RUN_STARTED",
      threadId: sessionId,
      runId: input.runId,
      metadata: { uiRevision: input.uiRevision },
    },
    {
      type: "CUSTOM",
      name: "lulu.progress.v1",
      value: { ...input, stage: "admission", invocation: 0 },
    },
    { type: "CUSTOM", name: "lulu.a2ui.v2", value: batch },
    {
      type: "RUN_FINISHED",
      threadId: sessionId,
      runId: input.runId,
      result: { uiRevision: input.uiRevision, status: "completed" },
    },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
}
