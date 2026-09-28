import { z } from "zod";
import { surfaceId, wireVersion } from "./messages";

// The API's lulu.a2ui.v1 extension permits only these hydrated browse nodes.
// Generated bindings, actions and shell/purchase-control replacements are rejected.
const text = z.string().max(8192);
const leafId = z.string().regex(/^agent-[a-z0-9-]{1,40}$/);
const image = z.union([z.literal(""), z.string().url().startsWith("https://")]);
const action = <T extends string>(name: T) =>
  z.object({ event: z.object({ name: z.literal(name) }).strict() }).strict();
const node = z.discriminatedUnion("component", [
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
      href: z.union([
        z.literal(""),
        z.string().regex(/^\/products\/[1-9]\d*$/),
      ]),
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
export const correlation = {
  runId: z.string().uuid(),
  uiRevision: z.number().int().nonnegative().safe(),
};
export const batchSchema = z
  .object({
    ...correlation,
    catalogId: z.literal("https://luluspeedworks.com/catalog/scaffold/v1"),
    messages: z
      .array(
        z
          .object({
            version: z.literal(wireVersion),
            updateComponents: z
              .object({
                surfaceId: z.literal(surfaceId),
                components: z.array(node).min(2).max(16),
              })
              .strict(),
          })
          .strict(),
      )
      .length(1),
    limitations: z.array(text).max(8),
  })
  .strict()
  .superRefine((batch, ctx) => {
    const nodes = batch.messages.flatMap(
      (message) => message.updateComponents.components,
    );
    const byId = new Map(nodes.map((value) => [value.id, value]));
    const rail = byId.get("products");
    const focus = byId.get("focus");
    const used = new Set(["products", "focus"]);
    let valid =
      byId.size === nodes.length &&
      rail?.component === "ProductRail" &&
      focus?.component === "ProductFocus";
    for (const value of nodes) {
      const refs =
        value.component === "ProductRail"
          ? value.entries
          : value.component === "ProductFocus"
            ? value.images
            : [];
      for (const id of refs) {
        const expected =
          value.component === "ProductRail" ? "ProductEntry" : "DetailImage";
        if (used.has(id) || byId.get(id)?.component !== expected) valid = false;
        used.add(id);
      }
    }
    if (!valid || used.size !== nodes.length)
      ctx.addIssue({
        code: "custom",
        message: "Invalid shopping component graph",
      });
  });
export type AgentBatch = z.infer<typeof batchSchema>;
export const fallbackSchema = z.enum([
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
]);

export const sessionSchema = z.object({
  sessionId: z.string().uuid(),
  capability: z.string().min(1),
  expiresAt: z.number().finite(),
  absoluteExpiresAt: z.number().finite(),
});
export type AgentSession = z.infer<typeof sessionSchema>;
export const requestSchema = z
  .object({ message: z.string().trim().min(1).max(8192) })
  .strict();

export const eventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("RUN_STARTED"),
    threadId: z.string(),
    runId: z.string(),
    metadata: z.object({ uiRevision: correlation.uiRevision }),
  }),
  z.object({
    type: z.literal("RUN_FINISHED"),
    threadId: z.string(),
    runId: z.string(),
    result: z.object({
      uiRevision: correlation.uiRevision,
      status: z.enum(["completed", "fallback"]),
      reason: fallbackSchema.optional(),
    }),
  }),
  z.object({ type: z.literal("CUSTOM"), name: z.string(), value: z.unknown() }),
]);
export const progressSchema = z
  .object({
    ...correlation,
    stage: z.enum(["admission", "inference"]),
    invocation: z.number().int().min(0).max(3),
  })
  .strict();
export const fallbackEventSchema = z
  .object({ ...correlation, reason: fallbackSchema })
  .strict();
