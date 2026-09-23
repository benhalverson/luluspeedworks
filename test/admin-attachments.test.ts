import { expect, it, vi } from "vitest";
import { z } from "zod";
import {
  savedTransfer,
  selectFiles,
  transferFile,
} from "../src/admin/attachments";
import type { AttachmentTransfer, ProductDraft } from "../src/admin/contracts";
import { DraftRequestError, draftRequest } from "../src/admin/request";

const draftId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const attachmentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const transferId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
function draft(): ProductDraft {
  return {
    id: draftId,
    target: { kind: "new" },
    revision: 3,
    createdAt: 1,
    updatedAt: 2,
    status: "active",
    cleanupPending: false,
    state: {
      answers: { name: "Preserved part", notes: "Keep these answers" },
      pendingQuestions: [],
      history: [],
    },
    context: { status: "new" },
    attachments: {
      photos: [],
      printFile: null,
      primaryPhotoId: null,
      photoOrder: [],
      transfers: [],
      validation: [],
      cleanup: [],
    },
  };
}
function transfer(
  overrides: Partial<AttachmentTransfer> = {},
): AttachmentTransfer {
  return {
    id: transferId,
    attachmentId,
    kind: "photo",
    name: "part.png",
    size: 1,
    contentType: null,
    status: "incomplete",
    replacesId: null,
    error: null,
    requiresReselection: true,
    ...overrides,
  };
}
const file = (name = "part.png", size = 1) =>
  new File([new Uint8Array(size)], name);
function responses(kind: "photo" | "print", upload = true) {
  const pending = draft();
  pending.revision++;
  pending.attachments.transfers = [transfer({ kind, status: "pending" })];
  const saved = draft();
  saved.revision += 2;
  saved.attachments.transfers = [
    transfer({ kind, status: "saved", requiresReselection: false }),
  ];
  const fetcher = vi.mocked(fetch);
  fetcher.mockResolvedValueOnce(
    Response.json({
      draft: pending,
      transfer: {
        id: transferId,
        upload: upload
          ? {
              method: "PUT",
              url:
                kind === "photo"
                  ? `/admin/product-drafts/${draftId}/attachments/transfers/${transferId}/content?expectedRevision=4`
                  : "https://uploads.example.test/presigned",
              headers: { "Content-Type": "application/octet-stream" },
            }
          : null,
      },
    }),
  );
  if (upload) {
    fetcher.mockResolvedValueOnce(
      kind === "photo"
        ? Response.json({ draft: saved })
        : new Response(null, { status: 200 }),
    );
    if (kind === "print")
      fetcher.mockResolvedValueOnce(Response.json({ draft: saved }));
  }
  return { pending, saved, fetcher };
}

it("sends private draft requests with credentials, no-store, validated JSON and caller cancellation", async () => {
  const controller = new AbortController();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ revision: 4 }));
  await expect(
    draftRequest(
      `/${draftId}`,
      z.object({ revision: z.number() }),
      "PUT",
      { expectedRevision: 3 },
      controller.signal,
    ),
  ).resolves.toEqual({ revision: 4 });
  expect(fetch).toHaveBeenCalledWith(
    new URL(`https://api.benhalverson.dev/admin/product-drafts/${draftId}`),
    expect.objectContaining({
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: '{"expectedRevision":3}',
    }),
  );
  const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
  expect(signal?.aborted).toBe(false);
  controller.abort();
  expect(signal?.aborted).toBe(true);
});

it("reads without a request body and rejects malformed successful responses", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockResolvedValueOnce(Response.json({ ok: "false" }));
  await expect(
    draftRequest("", z.object({ ok: z.boolean() })),
  ).resolves.toEqual({ ok: true });
  expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
  expect(vi.mocked(fetch).mock.calls[0]?.[1]).not.toHaveProperty("body");
  await expect(
    draftRequest("", z.object({ ok: z.boolean() })),
  ).rejects.toThrow();
});

it("preserves authoritative errors and supplies a fallback for invalid error bodies", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      Response.json({ error: "Revision conflict" }, { status: 409 }),
    )
    .mockResolvedValueOnce(
      new Response("upstream unavailable", { status: 502 }),
    )
    .mockResolvedValueOnce(
      Response.json({ detail: "unknown" }, { status: 500 }),
    );
  await expect(draftRequest("", z.unknown())).rejects.toMatchObject({
    status: 409,
    message: "Revision conflict",
  });
  await expect(draftRequest("", z.unknown())).rejects.toBeInstanceOf(
    DraftRequestError,
  );
  await expect(draftRequest("", z.unknown())).rejects.toThrow(
    "Draft request failed (500).",
  );
});

it("validates photo boundaries and formats before transfer without dropping valid selections", () => {
  const accepted = [
    file("max.JPG", 5_000_000),
    file("small.jpeg"),
    file("small.PNG"),
    file("small.webp"),
  ];
  const result = selectFiles(
    [
      file("empty.png", 0),
      ...accepted,
      file("large.png", 5_000_001),
      file("wrong.gif"),
    ],
    "photo",
    draft(),
    false,
  );
  expect(result.valid).toEqual(accepted);
  expect(result.errors).toEqual([
    "empty.png: the file is empty.",
    "large.png: photos must be 5,000,000 bytes or smaller.",
    "wrong.gif: select a JPG, PNG or WebP photo.",
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it("counts outstanding photo intents, permits replacement at capacity and limits print selection", () => {
  const current = draft();
  current.attachments.transfers = [
    transfer(),
    transfer(),
    transfer(),
    transfer(),
    transfer(),
    transfer({ status: "saved" }),
    transfer({ kind: "print" }),
    transfer({ replacesId: attachmentId }),
  ];
  expect(selectFiles([file()], "photo", current, false)).toEqual({
    valid: [],
    errors: ["part.png: a product can have at most five photos."],
  });
  const replacement = file("replacement.webp");
  expect(selectFiles([replacement, file()], "photo", current, true)).toEqual({
    valid: [replacement],
    errors: ["part.png: a product can have at most five photos."],
  });
  const model = file("part.stl", 5_000_001);
  expect(
    selectFiles([model, file("second.stl")], "print", current, false),
  ).toEqual({ valid: [model], errors: ["second.stl: select one print file."] });
});

it("persists a photo intent before upload, uses the new revision and preserves unrelated answers", async () => {
  const current = draft();
  const original = structuredClone(current);
  const { pending, saved, fetcher } = responses("photo");
  const publish = vi.fn();
  const selected = file();
  await expect(
    transferFile(current, selected, "photo", publish),
  ).resolves.toEqual(saved);
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
    expectedRevision: 3,
    kind: "photo",
    name: "part.png",
    size: 1,
  });
  expect(String(fetcher.mock.calls[1]?.[0])).toContain("expectedRevision=4");
  expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
    method: "PUT",
    credentials: "include",
    body: selected,
    headers: { "Content-Type": "application/octet-stream" },
  });
  expect(publish.mock.calls).toEqual([[pending], [saved]]);
  expect(saved.state).toEqual(original.state);
  expect(current).toEqual(original);
});

it("uploads print bytes without cookies then confirms the persisted provider transfer identity", async () => {
  const { pending, saved, fetcher } = responses("print");
  const publish = vi.fn();
  await expect(
    transferFile(draft(), file("part.stl"), "print", publish, attachmentId),
  ).resolves.toEqual(saved);
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
    replacesId: attachmentId,
  });
  expect(fetcher.mock.calls[1]?.[1]?.credentials).toBe("omit");
  expect(new URL(String(fetcher.mock.calls[2]?.[0])).pathname).toBe(
    `/admin/product-drafts/${draftId}/attachments/transfers/${transferId}/confirm`,
  );
  expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({
    expectedRevision: pending.revision,
  });
});

it("reuses an incomplete transfer only after targeted filename and size re-selection", async () => {
  const publish = vi.fn();
  await expect(
    transferFile(
      draft(),
      file("other.png"),
      "photo",
      publish,
      undefined,
      transfer(),
    ),
  ).rejects.toThrow("Reselect part.png (1 bytes).");
  await expect(
    transferFile(
      draft(),
      file("part.png", 2),
      "photo",
      publish,
      undefined,
      transfer(),
    ),
  ).rejects.toThrow("Reselect part.png");
  expect(fetch).not.toHaveBeenCalled();
  const { fetcher, saved } = responses("photo");
  await expect(
    transferFile(draft(), file(), "photo", publish, undefined, transfer()),
  ).resolves.toEqual(saved);
  expect(new URL(String(fetcher.mock.calls[0]?.[0])).pathname).toBe(
    `/admin/product-drafts/${draftId}/attachments/transfers/${transferId}/retry`,
  );
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
    expectedRevision: 3,
  });
});

it("leaves unresolved intent state visible without pretending that file bytes were uploaded", async () => {
  const { pending, fetcher } = responses("print", false);
  const publish = vi.fn();
  await expect(
    transferFile(draft(), file("part.stl"), "print", publish),
  ).rejects.toThrow(
    "Transfer pending. Review its saved state before retrying.",
  );
  expect(publish.mock.calls).toEqual([[pending]]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("retains the intent when transfer fails and does not confirm failed print bytes", async () => {
  const { pending, fetcher } = responses("print", false);
  fetcher.mockReset();
  fetcher
    .mockResolvedValueOnce(
      Response.json({
        draft: pending,
        transfer: {
          id: transferId,
          upload: {
            method: "PUT",
            url: "https://uploads.example.test/presigned",
            headers: {},
          },
        },
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 503 }));
  const publish = vi.fn();
  await expect(
    transferFile(draft(), file("part.stl"), "print", publish),
  ).rejects.toThrow(
    "Transfer failed (503). Your saved attachments are retained.",
  );
  expect(publish.mock.calls).toEqual([[pending]]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("accepts an already-saved recovery response without retransferring bytes", async () => {
  const current = draft();
  current.attachments.transfers = [
    transfer({ status: "saved", requiresReselection: false }),
  ];
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      draft: current,
      transfer: { id: transferId, upload: null },
    }),
  );
  const publish = vi.fn();
  await expect(
    transferFile(current, file(), "photo", publish, undefined, transfer()),
  ).resolves.toEqual(current);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls).toEqual([[current]]);
});

it("never reports HTTP 200 as saved when the authoritative transfer is unresolved", async () => {
  const current = draft();
  current.attachments.transfers = [
    transfer({
      status: "unresolved",
      requiresReselection: false,
      error: "Photo upload outcome is unknown; retry to check storage",
    }),
  ];
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      Response.json({
        draft: current,
        transfer: {
          id: transferId,
          upload: { method: "PUT", url: "/upload", headers: {} },
        },
      }),
    )
    .mockResolvedValueOnce(Response.json({ draft: current }));
  const publish = vi.fn();
  await expect(transferFile(current, file(), "photo", publish)).rejects.toThrow(
    "Photo upload outcome is unknown; retry to check storage",
  );
  expect(publish.mock.calls).toEqual([[current], [current]]);
  expect(current.state.answers.notes).toBe("Keep these answers");
});

it("requires the exact transfer to be saved rather than another transfer's success", () => {
  const current = draft();
  current.attachments.transfers = [
    transfer({ id: attachmentId, status: "saved" }),
  ];
  expect(() => savedTransfer(current, transferId)).toThrow(
    "Transfer unresolved. Review its saved state before retrying.",
  );
});

it.each([
  [
    () =>
      Response.json(
        { error: "Photo content cannot be decoded" },
        { status: 400 },
      ),
    "Photo content cannot be decoded",
  ],
  [
    () => new Response("Gateway error", { status: 502 }),
    "Transfer failed (502). Your saved attachments are retained.",
  ],
  [
    () => Response.json({ detail: "Invalid input" }, { status: 400 }),
    "Transfer failed (400). Your saved attachments are retained.",
  ],
])(
  "surfaces authoritative photo errors and retains intent when response is invalid (%#)",
  async (response, message) => {
    const current = draft();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          draft: current,
          transfer: {
            id: transferId,
            upload: { method: "PUT", url: "/upload", headers: {} },
          },
        }),
      )
      .mockResolvedValueOnce(response());
    const publish = vi.fn();
    await expect(
      transferFile(current, file(), "photo", publish),
    ).rejects.toThrow(message);
    expect(publish.mock.calls).toEqual([[current]]);
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);
