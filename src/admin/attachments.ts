import { z } from "zod";
import { apiOrigin } from "../storefront/auth";
import {
  type AttachmentTransfer,
  attachmentEnvelopeSchema,
  intentEnvelopeSchema,
  type ProductDraft,
} from "./contracts";
import { DraftRequestError, draftRequest } from "./request";

export function selectFiles(
  files: File[],
  kind: "photo" | "print",
  draft: ProductDraft,
  replacing: boolean,
) {
  const valid: File[] = [];
  const errors: string[] = [];
  const occupied =
    draft.attachments.photos.length +
    draft.attachments.transfers.filter(
      (transfer) =>
        transfer.kind === "photo" &&
        transfer.status !== "saved" &&
        !transfer.replacesId,
    ).length;
  const available = replacing ? 1 : 5 - occupied;
  for (const file of files) {
    if (!file.size) errors.push(`${file.name}: the file is empty.`);
    else if (kind === "photo" && file.size > 5_000_000)
      errors.push(`${file.name}: photos must be 5,000,000 bytes or smaller.`);
    else if (kind === "photo" && !/\.(jpe?g|png|webp)$/i.test(file.name))
      errors.push(`${file.name}: select a JPG, PNG or WebP photo.`);
    else if (valid.length >= (kind === "photo" ? available : 1))
      errors.push(
        `${file.name}: ${kind === "photo" ? "a product can have at most five photos" : "select one print file"}.`,
      );
    else valid.push(file);
  }
  return { valid, errors };
}

export async function transferFile(
  draft: ProductDraft,
  file: File,
  kind: "photo" | "print",
  publish: (draft: ProductDraft) => void,
  replacesId?: string,
  retry?: AttachmentTransfer,
) {
  if (retry && (file.name !== retry.name || file.size !== retry.size))
    throw new Error(`Reselect ${retry.name} (${retry.size} bytes).`);
  const intent = await draftRequest(
    `/${draft.id}/attachments/${retry ? `transfers/${retry.id}/retry` : "intents"}`,
    intentEnvelopeSchema,
    "POST",
    retry
      ? { expectedRevision: draft.revision }
      : {
          expectedRevision: draft.revision,
          kind,
          name: file.name,
          size: file.size,
          ...(replacesId ? { replacesId } : {}),
        },
  );
  publish(intent.draft);
  const upload = intent.transfer.upload;
  if (!upload) return savedTransfer(intent.draft, intent.transfer.id);
  const response = await fetch(new URL(upload.url, apiOrigin), {
    method: upload.method,
    headers: upload.headers,
    body: file,
    credentials: kind === "photo" ? "include" : "omit",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const error =
      kind === "photo"
        ? z
            .object({ error: z.string() })
            .safeParse(await response.json().catch(() => null))
        : null;
    throw new DraftRequestError(
      response.status,
      error?.success
        ? error.data.error
        : `Transfer failed (${response.status}). Your saved attachments are retained.`,
      kind === "photo" ? "draft" : "transfer",
    );
  }
  const result =
    kind === "photo"
      ? attachmentEnvelopeSchema.parse(await response.json())
      : await draftRequest(
          `/${draft.id}/attachments/transfers/${intent.transfer.id}/confirm`,
          attachmentEnvelopeSchema,
          "POST",
          { expectedRevision: intent.draft.revision },
        );
  publish(result.draft);
  return savedTransfer(result.draft, intent.transfer.id);
}

export function savedTransfer(draft: ProductDraft, transferId: string) {
  const transfer = draft.attachments.transfers.find(
    (item) => item.id === transferId,
  );
  if (transfer?.status !== "saved")
    throw new Error(
      transfer?.error ||
        `Transfer ${transfer?.status ?? "unresolved"}. Review its saved state before retrying.`,
    );
  return draft;
}
