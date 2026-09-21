import { z } from "zod";

const text = z.string().max(8192);
const leafId = z.string().regex(/^agent-[a-z0-9-]{1,40}$/);
const action = <T extends string>(name: T) =>
  z.object({ event: z.object({ name: z.literal(name) }).strict() }).strict();
const image = z
  .string()
  .refine(
    (value) =>
      value === "" || (/^https:\/\//i.test(value) && URL.canParse(value)),
  );
const nodeSchema = z.discriminatedUnion("component", [
  z
    .object({
      id: z.literal("products"),
      component: z.literal("ProductRail"),
      controls: z.tuple([]),
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
      name: text,
      description: text,
      price: text,
      image,
      href: z.string().regex(/^\/products\/[1-9]\d*$/),
    })
    .strict(),
  z
    .object({
      id: z.literal("focus"),
      component: z.literal("ProductFocus"),
      title: text,
      description: text,
      selectedTitle: text,
      selectedDescription: text,
      active: z.boolean(),
      ready: z.boolean(),
      price: text,
      sku: text,
      compatibility: text,
      images: z.array(leafId).max(1),
      retryVisible: z.literal(false),
      retry: action("retry-product"),
    })
    .strict(),
  z
    .object({
      id: leafId,
      component: z.literal("DetailImage"),
      src: image,
      name: text,
    })
    .strict(),
]);
const nodes = z
  .array(nodeSchema)
  .min(2)
  .max(16)
  .refine((components) => {
    const byId = new Map(components.map((node) => [node.id, node]));
    const rail = byId.get("products");
    const focus = byId.get("focus");
    if (
      byId.size !== components.length ||
      rail?.component !== "ProductRail" ||
      focus?.component !== "ProductFocus"
    )
      return false;
    const references = [...rail.entries, ...focus.images];
    return (
      new Set(references).size === references.length &&
      references.length + 2 === components.length &&
      rail.entries.every((id) => byId.get(id)?.component === "ProductEntry") &&
      focus.images.every((id) => byId.get(id)?.component === "DetailImage")
    );
  }, "Invalid component graph");

export const compositionSchema = z
  .object({
    runId: z.string().uuid(),
    uiRevision: z.number().int().nonnegative().safe(),
    catalogId: z.literal("https://luluspeedworks.com/catalog/scaffold/v1"),
    messages: z.tuple([
      z
        .object({
          version: z.literal("v0.9.1"),
          updateComponents: z
            .object({ surfaceId: z.literal("storefront"), components: nodes })
            .strict(),
        })
        .strict(),
    ]),
    limitations: z.array(text).max(3),
  })
  .strict()
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength <= 36 * 1024,
  );
export type AgentComposition = z.infer<typeof compositionSchema>;

export const shoppingMessage = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Enter a shopping request.")
    .max(8192, "Keep your request under 8,192 characters."),
});

export const sessionSchema = z.object({
  sessionId: z.string().uuid(),
  capability: z.string().min(32).max(256),
  expiresAt: z.number().int().positive(),
  absoluteExpiresAt: z.number().int().positive(),
});

export const fallbackSchema = z
  .object({
    runId: z.string().uuid(),
    uiRevision: z.number().int().nonnegative(),
    reason: z.enum([
      "disabled",
      "inference_unavailable",
      "accounting_unavailable",
      "budget_exhausted",
      "rate_limited",
      "invalid_output",
      "catalog_unavailable",
      "timeout",
      "cancelled",
      "superseded",
      "disconnected",
      "interrupted",
      "tool_limit",
    ]),
  })
  .strict();
