import { z } from "zod";
import {
  agentNodeSchema,
  batchSchema,
  correlation,
  type LiteralAgentBatch,
} from "./agent-contract";
import { surfaceId, wireVersion } from "./messages";

export const bindingContract = "lulu.a2ui.v2";
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
const nodes = z.discriminatedUnion("component", [
  agentNodeSchema.options[0],
  agentNodeSchema.options[1].extend({
    name: binding("name"),
    description: binding("description"),
    image: binding("image"),
    price: binding("price"),
    href: binding("href"),
  }),
  agentNodeSchema.options[2].extend({
    selectedTitle: z.union([z.literal(""), binding("name")]),
    selectedDescription: z.union([z.literal(""), binding("description")]),
    href: z.union([z.literal(""), binding("href")]),
    price: z.union([z.literal(""), binding("price")]),
    sku: z.union([z.literal(""), binding("sku")]),
    compatibility: z.union([z.literal(fitUnknown), binding("compatibility")]),
  }),
  agentNodeSchema.options[3].extend({
    src: binding("image"),
    name: binding("name"),
  }),
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
export const bindingBatchSchema = z
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
    const resolved = components.map((node) => {
      const keys = new Set<string>();
      let count = 0;
      const fields = Object.entries(node).map(([field, value]) => {
        if (typeof value !== "object" || !("path" in value))
          return [field, value];
        const key = value.path.slice(
          prefix.length,
          value.path.lastIndexOf("/"),
        );
        count++;
        keys.add(key);
        used.add(key);
        selections.set(node.id, key);
        return [field, paths.get(value.path)];
      });
      if (keys.size > 1) valid = false;
      if (node.component === "ProductFocus") {
        if (node.active !== node.ready || node.active !== (count === 6))
          valid = false;
        if (!node.active && (count !== 0 || node.images.length !== 0))
          valid = false;
      }
      return Object.fromEntries(fields);
    });
    const focus = components.find((node) => node.component === "ProductFocus");
    if (focus)
      for (const image of focus.images)
        if (selections.get(image) !== selections.get(focus.id)) valid = false;
    if (used.size !== Object.keys(products).length) valid = false;
    const literal = batchSchema.safeParse({
      ...batch,
      messages: [
        {
          version: wireVersion,
          updateComponents: { surfaceId, components: resolved },
        },
      ],
    });
    const size = new TextEncoder().encode(
      JSON.stringify({
        catalogId: batch.catalogId,
        messages: batch.messages,
        limitations: batch.limitations,
      }),
    ).byteLength;
    if (!valid || !literal.success || size > 32768)
      ctx.addIssue({
        code: "custom",
        message: "Invalid public catalog bindings",
      });
  });

export type AgentBatch = LiteralAgentBatch | z.infer<typeof bindingBatchSchema>;
