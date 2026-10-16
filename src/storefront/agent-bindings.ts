import { z } from "zod";
import { correlation } from "./agent-contract";
import { surfaceId, wireVersion } from "./messages";

const prefix = "/agentCatalog/products/";
const fitUnknown =
  "Compatibility is not supplied by this catalog. Verify fit before purchasing.";
/** Each component field can bind only to its corresponding public record field. */
const binding = (field: string) =>
  z
    .object({
      path: z.string().regex(new RegExp(`^${prefix}[1-9]\\d*/${field}$`)),
    })
    .strict();
const text = z.string().max(8192);
const leafId = z.string().regex(/^agent-[a-z0-9-]{1,40}$/);
/** Permit only the named trusted shell action, without model-provided arguments. */
const action = <T extends string>(name: T) =>
  z.object({ event: z.object({ name: z.literal(name) }).strict() }).strict();
const nodes = z.discriminatedUnion("component", [
  z
    .object({
      id: z.literal("products"),
      component: z.literal("ProductRail"),
      controls: z.array(z.never()).length(0),
      entries: z.array(leafId).max(12),
      status: text,
      paging: z.literal(""),
      previousDisabled: z.literal(true),
      nextDisabled: z.literal(true),
      retryVisible: z.literal(false),
      previous: action("previous"),
      next: action("next"),
      retry: action("retry"),
    })
    .strict(),
  z
    .object({
      id: leafId,
      component: z.literal("ProductEntry"),
      name: binding("name"),
      description: binding("description"),
      price: binding("price"),
      image: binding("image"),
      href: binding("href"),
    })
    .strict(),
  z
    .object({
      id: z.literal("focus"),
      component: z.literal("ProductFocus"),
      title: text,
      description: text,
      selectedTitle: z.union([z.literal(""), binding("name")]),
      selectedDescription: z.union([z.literal(""), binding("description")]),
      href: z.union([z.literal(""), binding("href")]),
      active: z.boolean(),
      ready: z.boolean(),
      price: z.union([z.literal(""), binding("price")]),
      sku: z.union([z.literal(""), binding("sku")]),
      compatibility: z.union([z.literal(fitUnknown), binding("compatibility")]),
      images: z.array(leafId).max(1),
      retryVisible: z.literal(false),
      retry: action("retry-product"),
    })
    .strict(),
  z
    .object({
      id: leafId,
      component: z.literal("DetailImage"),
      src: binding("image"),
      name: binding("name"),
    })
    .strict(),
]);
const product = z
  .object({
    id: z.number().int().positive().safe(),
    name: z.string().max(512),
    description: z.string().max(4096),
    image: z.union([
      z.literal(""),
      z.string().url().startsWith("https://").max(2048),
    ]),
    price: z.string().max(128),
    sku: z.string().max(8192),
    href: z.string().regex(/^\/products\/[1-9]\d*$/),
    compatibility: z.string().max(8192),
  })
  .strict();

/** Validate the entire public snapshot and graph before either reaches A2UI. */
export const batchSchema = z
  .object({
    ...correlation,
    catalogId: z.literal("https://luluspeedworks.com/catalog/scaffold/v1"),
    limitations: z.array(z.string().max(8192)).max(8),
    messages: z.tuple([
      z
        .object({
          version: z.literal(wireVersion),
          updateDataModel: z
            .object({
              surfaceId: z.literal(surfaceId),
              path: z.literal("/agentCatalog"),
              value: z
                .object({
                  products: z.record(z.string().regex(/^[1-9]\d*$/), product),
                })
                .strict(),
            })
            .strict(),
        })
        .strict(),
      z
        .object({
          version: z.literal(wireVersion),
          updateComponents: z
            .object({
              surfaceId: z.literal(surfaceId),
              components: z.array(nodes).min(2).max(16),
            })
            .strict(),
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((batch, ctx) => {
    const { products } = batch.messages[0].updateDataModel.value;
    const components = batch.messages[1].updateComponents.components;
    const paths = new Map<string, string | number>();
    let valid = Object.keys(products).length <= 13;
    for (const [key, record] of Object.entries(products)) {
      if (key !== String(record.id) || record.href !== `/products/${key}`)
        valid = false;
      for (const [field, value] of Object.entries(record))
        paths.set(`${prefix}${key}/${field}`, value);
    }
    const used = new Set<string>();
    const selections = new Map<string, string>();
    for (const node of components) {
      const keys = new Set<string>();
      let count = 0;
      for (const value of Object.values(node)) {
        if (typeof value !== "object" || !("path" in value)) continue;
        const key = value.path.slice(
          prefix.length,
          value.path.lastIndexOf("/"),
        );
        count++;
        keys.add(key);
        used.add(key);
        selections.set(node.id, key);
        if (!paths.has(value.path)) valid = false;
      }
      if (keys.size > 1) valid = false;
      if (node.component === "ProductFocus") {
        if (node.active !== node.ready || node.active !== (count === 6))
          valid = false;
        if (!node.active && (count !== 0 || node.images.length !== 0))
          valid = false;
      }
    }
    const focus = components.find((node) => node.component === "ProductFocus");
    if (focus)
      for (const image of focus.images)
        if (selections.get(image) !== selections.get(focus.id)) valid = false;
    if (used.size !== Object.keys(products).length) valid = false;
    const byId = new Map(components.map((value) => [value.id, value]));
    const rail = byId.get("products");
    const rootFocus = byId.get("focus");
    const referenced = new Set(["products", "focus"]);
    valid &&=
      byId.size === components.length &&
      rail?.component === "ProductRail" &&
      rootFocus?.component === "ProductFocus";
    for (const value of components) {
      const refs =
        value.component === "ProductRail"
          ? value.entries
          : value.component === "ProductFocus"
            ? value.images
            : [];
      for (const id of refs) {
        const expected =
          value.component === "ProductRail" ? "ProductEntry" : "DetailImage";
        if (referenced.has(id) || byId.get(id)?.component !== expected)
          valid = false;
        referenced.add(id);
      }
    }
    if (referenced.size !== components.length) valid = false;
    const size = new TextEncoder().encode(
      JSON.stringify({
        catalogId: batch.catalogId,
        messages: batch.messages,
        limitations: batch.limitations,
      }),
    ).byteLength;
    if (!valid || size > 32768)
      ctx.addIssue({
        code: "custom",
        message: "Invalid public catalog bindings",
      });
  });

export type AgentBatch = z.infer<typeof batchSchema>;
