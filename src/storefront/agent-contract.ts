import { z } from "zod";

export const correlation = {
  runId: z.string().uuid(),
  uiRevision: z.number().int().nonnegative().safe(),
};
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

// Duplicate-run replies are metadata only: they never replay a composition.
export const runStatusSchema = z.discriminatedUnion("status", [
  z
    .object({ ...correlation, status: z.literal("running"), reason: z.null() })
    .strict(),
  z
    .object({
      ...correlation,
      status: z.literal("completed"),
      reason: z.null(),
    })
    .strict(),
  z
    .object({
      ...correlation,
      status: z.literal("fallback"),
      reason: fallbackSchema,
    })
    .strict(),
]);
