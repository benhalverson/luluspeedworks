import { z } from "zod";
import { attachmentCleanupSchema, draftRevisionSchema } from "./contracts";

export const preparationRequestSchema = z
  .object({
    expectedRevision: draftRevisionSchema.min(1),
    action: z.enum(["create", "update", "delete"]).optional(),
  })
  .strict();
export const preparationValidationSchema = z
  .object({ field: z.string(), code: z.string(), message: z.string() })
  .strict();
export const preparedSnapshotSchema = z
  .object({
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("new") }).strict(),
      z
        .object({
          kind: z.literal("existing"),
          productId: z.number().int().positive(),
        })
        .strict(),
    ]),
    action: z.enum(["create", "update", "delete"]),
    productRevision: z.number().int().nonnegative().nullable(),
    name: z.string(),
    description: z.string(),
    categoryIds: z.array(z.number().int().positive()),
    filamentType: z.string(),
    color: z.string(),
    publicFileServiceId: z.string(),
    stl: z.string(),
    image: z.string(),
    imageGallery: z.array(z.string()),
    primaryPhotoAssetId: z.string().nullable(),
    assetIds: z.array(z.string()),
    cleanupAssetIds: z.array(z.string()),
    assetRevisions: z.array(
      z.object({ id: z.string(), revision: z.number().int() }).strict(),
    ),
    categoryBindings: z.array(
      z.object({ categoryId: z.number(), categoryName: z.string() }).strict(),
    ),
    sourceBinding: z.string(),
  })
  .strict();
export const preparationPricingSchema = z
  .object({
    currency: z.literal("USD"),
    productionCost: z.number().finite().nonnegative().nullable(),
    markupPercentage: z.number().finite().positive().nullable(),
    onlinePrice: z.number().finite().nonnegative().nullable(),
    inPersonPrice: z.number().finite().nonnegative().nullable(),
    basis: z
      .object({
        publicFileServiceId: z.string(),
        filamentId: z.string().uuid(),
        material: z.string(),
        color: z.string(),
        quantity: z.literal(1),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const preparationSchema = z
  .object({
    id: z.string().uuid(),
    draftRevision: draftRevisionSchema,
    preparedAt: z.number().int().nonnegative(),
    status: z.enum(["ready", "blocked", "unavailable", "stale"]),
    readiness: z
      .object({ ready: z.boolean(), submissionAuthorized: z.literal(false) })
      .strict(),
    validation: z.array(preparationValidationSchema),
    pricing: preparationPricingSchema,
    snapshot: preparedSnapshotSchema.nullable(),
  })
  .strict();

/** Explicit card actions are the only catalog mutation authority. */
export const actionSchema = z.enum(["create", "update", "delete"]);
export const preparationResponseSchema = z
  .object({ preparation: preparationSchema.nullable() })
  .strict();
export const operationSchema = z
  .object({
    id: z.string().uuid(),
    draftId: z.string().uuid(),
    preparationId: z.string().uuid(),
    action: actionSchema,
    state: z.enum([
      "prepared",
      "pending",
      "item_confirmed",
      "square_confirmed",
      "repair_required",
      "succeeded",
      "failed",
    ]),
    productId: z.number().int().positive().nullable(),
    error: z.string().nullable(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
    retryable: z.boolean(),
    cleanup: z.array(attachmentCleanupSchema),
  })
  .strict();
/** Current productsTable fields returned by productPrices, with USD in-person prices. */
export const currentCatalogItemSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    description: z.string(),
    image: z.string().nullable(),
    imageGallery: z.string().nullable(),
    stl: z.string(),
    price: z.number(),
    markupPercentage: z.number().nullable(),
    filamentType: z.string(),
    skuNumber: z.string().nullable(),
    color: z.string().nullable(),
    inPersonPrice: z.number().nullable(),
    publicFileServiceId: z.string().nullable(),
    categoryId: z.number().int().nullable(),
  })
  .strict();
export const catalogReadinessSchema = z
  .object({
    productId: z.number(),
    skuNumber: z.string().nullable(),
    name: z.string().nullable(),
    checkoutReady: z.boolean(),
    reasons: z.array(
      z.enum([
        "product_missing",
        "missing_public_file_service_id",
        "invalid_quantity",
        "invalid_filament_id",
        "unavailable_filament_id",
      ]),
    ),
    publicFileServiceId: z.string().nullable(),
    defaultFilamentId: z.string(),
  })
  .strict();
export const mutationResultSchema = z
  .object({
    operation: operationSchema.nullable(),
    product: currentCatalogItemSchema.nullable(),
    readiness: catalogReadinessSchema.nullable(),
    storefrontVisible: z.boolean(),
  })
  .strict();
export type Action = z.infer<typeof actionSchema>;
export type Preparation = z.infer<typeof preparationSchema>;
export type Operation = z.infer<typeof operationSchema>;
export type MutationResult = z.infer<typeof mutationResultSchema>;
export type CurrentCatalogItem = z.infer<typeof currentCatalogItemSchema>;
