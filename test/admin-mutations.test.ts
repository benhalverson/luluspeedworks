import { expect, it } from "vitest";
import {
  type MutationResult,
  mutationResultSchema,
  type Preparation,
  preparationResponseSchema,
} from "../src/admin/mutations";
import { draftId, photoId, transferId } from "./admin-fixtures";

const preparation: Preparation = {
  id: transferId,
  draftRevision: 2,
  preparedAt: 100,
  status: "ready",
  readiness: { ready: true, submissionAuthorized: false },
  validation: [],
  pricing: {
    currency: "USD",
    productionCost: 5,
    markupPercentage: 50,
    onlinePrice: 7.5,
    inPersonPrice: 9,
    basis: {
      publicFileServiceId: "print-file",
      filamentId: photoId,
      material: "PLA",
      color: "Black",
      quantity: 1,
    },
  },
  snapshot: {
    target: { kind: "existing", productId: 1 },
    action: "update",
    productRevision: 1,
    name: "Part",
    description: "A printed part",
    categoryIds: [1],
    filamentType: "PLA",
    color: "Black",
    publicFileServiceId: "print-file",
    stl: "part.stl",
    image: "part.png",
    imageGallery: ["part.png"],
    primaryPhotoAssetId: photoId,
    assetIds: [photoId],
    cleanupAssetIds: [],
    assetRevisions: [{ id: photoId, revision: 1 }],
    categoryBindings: [{ categoryId: 1, categoryName: "Parts" }],
    sourceBinding: "catalog-binding",
  },
};
const mutation: MutationResult = {
  operation: {
    id: photoId,
    draftId,
    preparationId: transferId,
    action: "update",
    state: "succeeded",
    productId: 1,
    error: null,
    createdAt: 100,
    updatedAt: 101,
    retryable: false,
    cleanup: [],
  },
  product: {
    id: 1,
    name: "Part",
    description: "A printed part",
    image: "part.png",
    imageGallery: '["part.png"]',
    stl: "part.stl",
    price: 7.5,
    markupPercentage: 50,
    filamentType: "PLA",
    skuNumber: "PART-1",
    color: "Black",
    inPersonPrice: 9,
    publicFileServiceId: "print-file",
    categoryId: 1,
  },
  readiness: {
    productId: 1,
    skuNumber: "PART-1",
    name: "Part",
    checkoutReady: true,
    reasons: [],
    publicFileServiceId: "print-file",
    defaultFilamentId: transferId,
  },
  storefrontVisible: true,
};

it("retains the exact prepared snapshot and USD pricing without granting submission authority", () => {
  expect(preparationResponseSchema.parse({ preparation })).toEqual({
    preparation,
  });
  expect(preparationResponseSchema.parse({ preparation: null })).toEqual({
    preparation: null,
  });
  expect(
    preparationResponseSchema.safeParse({
      preparation: {
        ...preparation,
        readiness: { ready: true, submissionAuthorized: true },
      },
    }).success,
  ).toBe(false);
  expect(
    preparationResponseSchema.safeParse({
      preparation: {
        ...preparation,
        pricing: { ...preparation.pricing, currency: "EUR" },
      },
    }).success,
  ).toBe(false);
});

it("preserves all current catalog fields and durable mutation/readiness evidence", () => {
  expect(mutationResultSchema.parse(mutation)).toEqual(mutation);
  expect(
    mutationResultSchema.parse({
      operation: null,
      product: null,
      readiness: null,
      storefrontVisible: false,
    }),
  ).toEqual({
    operation: null,
    product: null,
    readiness: null,
    storefrontVisible: false,
  });
  expect(
    mutationResultSchema.safeParse({
      ...mutation,
      product: { ...mutation.product, imageGallery: ["part.png"] },
    }).success,
  ).toBe(false);
  expect(
    mutationResultSchema.safeParse({
      ...mutation,
      product: { ...mutation.product, squareRevision: 1 },
    }).success,
  ).toBe(false);
  expect(
    mutationResultSchema.safeParse({
      ...mutation,
      operation: { ...mutation.operation, state: "unknown" },
    }).success,
  ).toBe(false);
});
