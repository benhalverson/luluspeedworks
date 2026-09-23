import { z } from "zod";

export const attachmentKindSchema = z.enum(["photo", "print"]);
export const transferStatusSchema = z.enum([
  "pending",
  "saved",
  "incomplete",
  "failed",
  "unresolved",
]);
export const savedAttachmentSchema = z
  .object({
    id: z.string().uuid(),
    assetId: z.string().uuid(),
    kind: attachmentKindSchema,
    name: z.string(),
    size: z.number().int().nonnegative(),
    contentType: z.string(),
    status: z.literal("saved"),
    imageUrl: z.string().nullable(),
    publicFileServiceId: z.string().nullable(),
  })
  .strict();
export const attachmentTransferSchema = z
  .object({
    id: z.string().uuid(),
    attachmentId: z.string().uuid(),
    kind: attachmentKindSchema,
    name: z.string(),
    size: z.number().int().positive(),
    contentType: z.string().nullable(),
    status: transferStatusSchema,
    replacesId: z.string().uuid().nullable(),
    error: z.string().nullable(),
    requiresReselection: z.boolean(),
  })
  .strict();
export const attachmentCleanupSchema = z
  .object({
    id: z.string().uuid(),
    assetId: z.string().uuid(),
    status: z.enum(["pending", "deleted", "protected"]),
    reason: z.string().nullable(),
  })
  .strict();
export const productAttachmentsSchema = z
  .object({
    photos: z.array(savedAttachmentSchema),
    printFile: savedAttachmentSchema.nullable(),
    primaryPhotoId: z.string().uuid().nullable(),
    photoOrder: z.array(z.string().uuid()),
    transfers: z.array(attachmentTransferSchema),
    validation: z.array(
      z
        .object({ field: z.string(), code: z.string(), message: z.string() })
        .strict(),
    ),
    cleanup: z.array(attachmentCleanupSchema),
  })
  .strict();
export const attachmentRevisionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER - 1);
export const attachmentIntentSchema = z
  .object({
    expectedRevision: attachmentRevisionSchema,
    kind: attachmentKindSchema,
    name: z.string().trim().min(1).max(512),
    size: z.number().int().positive().safe(),
    replacesId: z.string().uuid().optional(),
  })
  .strict();
export const attachmentActionSchema = z
  .object({ expectedRevision: attachmentRevisionSchema })
  .strict();
export const attachmentEditSchema = attachmentActionSchema
  .extend({
    primaryPhotoId: z.string().uuid().nullable().optional(),
    photoOrder: z.array(z.string().uuid()).max(5).optional(),
  })
  .strict();
export const attachmentUploadSchema = z
  .object({
    id: z.string().uuid(),
    upload: z
      .object({
        method: z.literal("PUT"),
        url: z.string(),
        headers: z.record(z.string()),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const draftCleanupResponseSchema = z
  .object({
    id: z.string().uuid(),
    revision: attachmentRevisionSchema,
    status: z.enum(["active", "discarded"]),
    cleanup: z.array(attachmentCleanupSchema),
  })
  .strict();
export type SavedAttachment = z.infer<typeof savedAttachmentSchema>;
export type AttachmentTransfer = z.infer<typeof attachmentTransferSchema>;
export type AttachmentCleanup = z.infer<typeof attachmentCleanupSchema>;
export type ProductAttachments = z.infer<typeof productAttachmentsSchema>;
export type AttachmentIntent = z.infer<typeof attachmentIntentSchema>;
export type AttachmentEdit = z.infer<typeof attachmentEditSchema>;
export type AttachmentUpload = z.infer<typeof attachmentUploadSchema>;

const productIdSchema = z.number().int().positive().safe();
export const draftRevisionSchema = z.number().int().positive().safe();
export const productDraftTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }).strict(),
  z
    .object({ kind: z.literal("existing"), productId: productIdSchema })
    .strict(),
]);

// These are supplied answers, never catalog values or execution authority.
export const productDraftAnswersSchema = z
  .object({
    name: z.string().max(512).optional(),
    description: z.string().max(16384).optional(),
    categoryIds: z.array(productIdSchema).max(100).optional(),
    filamentType: z.string().max(256).optional(),
    color: z.string().max(256).optional(),
    notes: z.string().max(16384).optional(),
  })
  .strict();
export const productDraftStateSchema = z
  .object({
    answers: productDraftAnswersSchema,
    pendingQuestions: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            prompt: z.string().min(1).max(4096),
          })
          .strict(),
      )
      .max(100),
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().max(16384),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
export const beginProductDraftSchema = z
  .object({
    target: productDraftTargetSchema,
    state: productDraftStateSchema.optional(),
  })
  .strict();
export const saveProductDraftSchema = z
  .object({
    expectedRevision: draftRevisionSchema.max(Number.MAX_SAFE_INTEGER - 1),
    state: productDraftStateSchema,
  })
  .strict();
export const discardProductDraftSchema = z
  .object({
    expectedRevision: z
      .string()
      .regex(/^[1-9]\d*$/)
      .transform(Number)
      .pipe(draftRevisionSchema),
  })
  .strict();
export const productDraftIdSchema = z
  .object({ id: z.string().uuid() })
  .strict();

export const productDraftContextSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("new") }).strict(),
  z
    .object({ status: z.literal("unavailable"), productId: productIdSchema })
    .strict(),
  z
    .object({
      status: z.literal("available"),
      product: z
        .object({
          id: productIdSchema,
          name: z.string(),
          description: z.string(),
          image: z.string().nullable(),
          price: z.number(),
          filamentType: z.string(),
          color: z.string().nullable(),
          skuNumber: z.string().nullable(),
          publicFileServiceId: z.string().nullable(),
        })
        .strict(),
      categories: z.array(
        z
          .object({
            categoryId: productIdSchema,
            categoryName: z.string(),
          })
          .strict(),
      ),
    })
    .strict(),
]);
export const productDraftSummarySchema = z
  .object({
    id: z.string().uuid(),
    target: productDraftTargetSchema,
    revision: draftRevisionSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    status: z.enum(["active", "discarded"]),
    cleanupPending: z.boolean(),
  })
  .strict();
export const productDraftResponseSchema = productDraftSummarySchema
  .extend({
    state: productDraftStateSchema,
    context: productDraftContextSchema,
    attachments: productAttachmentsSchema,
  })
  .strict();
export const productDraftListSchema = z
  .object({ drafts: z.array(productDraftSummarySchema) })
  .strict();
export type ProductDraftTarget = z.infer<typeof productDraftTargetSchema>;
export type ProductDraftState = z.infer<typeof productDraftStateSchema>;
export type ProductDraftContext = z.infer<typeof productDraftContextSchema>;
export type BeginProductDraft = z.infer<typeof beginProductDraftSchema>;
export type SaveProductDraft = z.infer<typeof saveProductDraftSchema>;
export type DiscardProductDraft = z.infer<typeof discardProductDraftSchema>;
export type ProductDraft = z.infer<typeof productDraftResponseSchema>;
export type ProductDraftSummary = z.infer<typeof productDraftSummarySchema>;
export type ProductDraftList = z.infer<typeof productDraftListSchema>;

export const attachmentEnvelopeSchema = z
  .object({ draft: productDraftResponseSchema })
  .strict();
export const intentEnvelopeSchema = attachmentEnvelopeSchema
  .extend({ transfer: attachmentUploadSchema })
  .strict();
