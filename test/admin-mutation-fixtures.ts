import type {
  Action,
  MutationResult,
  Preparation,
} from "../src/admin/mutations";
import { draftId } from "./admin-fixtures";

export const preparationId = "66666666-6666-4666-8666-666666666666";
export const operationId = "77777777-7777-4777-8777-777777777777";

export function preparation(
  action: Action = "create",
  overrides: Partial<Preparation> = {},
): Preparation {
  return {
    id: preparationId,
    draftRevision: 1,
    preparedAt: 1,
    status: "ready",
    readiness: { ready: true, submissionAuthorized: false },
    validation: [],
    pricing: {
      currency: "USD",
      productionCost: 10,
      markupPercentage: 50,
      onlinePrice: 15,
      inPersonPrice: 12,
      basis: null,
    },
    snapshot: {
      target:
        action === "create"
          ? { kind: "new" }
          : { kind: "existing", productId: 42 },
      action,
      productRevision: action === "create" ? null : 1,
      name: "Prepared part",
      description: "Prepared description",
      categoryIds: [1],
      filamentType: "PLA",
      color: "Red",
      publicFileServiceId: "file-42",
      stl: "part.stl",
      image: "part.png",
      imageGallery: [],
      primaryPhotoAssetId: null,
      assetIds: [],
      cleanupAssetIds: [],
      assetRevisions: [],
      categoryBindings: [{ categoryId: 1, categoryName: "Parts" }],
      sourceBinding: "binding",
    },
    ...overrides,
  };
}

export function mutationResult(
  action: Action = "create",
  overrides: Partial<MutationResult> = {},
): MutationResult {
  return {
    operation: {
      id: operationId,
      draftId,
      preparationId,
      action,
      state: "succeeded",
      productId: 42,
      error: null,
      createdAt: 1,
      updatedAt: 1,
      retryable: false,
      cleanup: [],
    },
    product: {
      id: 42,
      name: "Prepared part",
      description: "Prepared description",
      image: "part.png",
      imageGallery: null,
      stl: "part.stl",
      price: 15,
      markupPercentage: 50,
      filamentType: "PLA",
      skuNumber: null,
      color: "Red",
      inPersonPrice: 12,
      publicFileServiceId: "file-42",
      categoryId: 1,
    },
    readiness: {
      productId: 42,
      skuNumber: null,
      name: "Prepared part",
      checkoutReady: true,
      reasons: [],
      publicFileServiceId: "file-42",
      defaultFilamentId: "88888888-8888-4888-8888-888888888888",
    },
    storefrontVisible: true,
    ...overrides,
  };
}
