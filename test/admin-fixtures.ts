import type {
  AttachmentTransfer,
  ProductDraft,
  SavedAttachment,
} from "../src/admin/contracts";

export const draftId = "11111111-1111-4111-8111-111111111111";
export const otherId = "22222222-2222-4222-8222-222222222222";
export const photoId = "33333333-3333-4333-8333-333333333333";
export const otherPhotoId = "44444444-4444-4444-8444-444444444444";
export const transferId = "55555555-5555-4555-8555-555555555555";
export function draft(overrides: Partial<ProductDraft> = {}): ProductDraft {
  return {
    id: draftId,
    revision: 1,
    target: { kind: "new" },
    status: "active",
    cleanupPending: false,
    createdAt: 1,
    updatedAt: 1,
    context: { status: "new" },
    state: { answers: {}, pendingQuestions: [], history: [] },
    attachments: {
      photos: [],
      printFile: null,
      primaryPhotoId: null,
      photoOrder: [],
      transfers: [],
      validation: [],
      cleanup: [],
    },
    ...overrides,
  };
}
export function photo(
  overrides: Partial<SavedAttachment> = {},
): SavedAttachment {
  return {
    id: photoId,
    assetId: photoId,
    kind: "photo",
    name: "part.png",
    size: 4,
    contentType: "image/png",
    status: "saved",
    imageUrl: "/private/part.png",
    publicFileServiceId: null,
    ...overrides,
  };
}
export function transfer(
  overrides: Partial<AttachmentTransfer> = {},
): AttachmentTransfer {
  return {
    id: transferId,
    attachmentId: otherPhotoId,
    kind: "photo",
    name: "resume.png",
    size: 4,
    contentType: null,
    status: "incomplete",
    replacesId: null,
    error: null,
    requiresReselection: true,
    ...overrides,
  };
}
