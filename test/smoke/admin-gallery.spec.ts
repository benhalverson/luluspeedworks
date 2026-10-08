import {
  draft,
  draftId,
  otherPhotoId,
  photo,
  photoId,
  transfer,
} from "../admin-fixtures";
import { checkLayout, draftList, expect, test } from "./fixtures";

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4AWJ6tVXjPwgzMUABAAAA//8Lw1LcAAAABklEQVQDAEt4BZFa6totAAAAAElFTkSuQmCC";
test("mocked retained gallery supports keyboard order, primary, add, replace, remove and print reload", async ({
  page,
  api,
}) => {
  const root = `/admin/product-drafts/${draftId}`;
  const saved = draft({
    target: { kind: "existing", productId: 42 },
    context: {
      status: "available",
      product: {
        id: 42,
        name: "Gallery part",
        description: "Physical part",
        image,
        imageGallery: [image, image],
        price: 15,
        filamentType: "PLA",
        color: "Red",
        skuNumber: null,
        publicFileServiceId: null,
      },
      categories: [],
    },
  });
  saved.attachments.photos = [
    photo({
      name: "retained-one.png",
      imageUrl: image,
      catalogSource: { productId: 42, url: image, managed: true },
    }),
    photo({
      id: otherPhotoId,
      assetId: otherPhotoId,
      name: "retained-two.png",
      imageUrl: image,
      catalogSource: { productId: 42, url: image, managed: true },
    }),
  ];
  saved.attachments.photoOrder = [photoId, otherPhotoId];
  saved.attachments.primaryPhotoId = photoId;
  const publish = () => {
    api.responses.set("GET /admin/product-drafts", { body: draftList(saved) });
    api.responses.set(`GET ${root}`, { body: saved });
  };
  publish();
  const uploads = new Map<
    string,
    { kind: "photo" | "print"; name: string; size: number; replacesId?: string }
  >();
  await page.route(
    `https://api.lulu.test${root}/attachments**`,
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const body = request.method() === "DELETE" ? {} : request.postDataJSON();
      if (path.endsWith("/confirm"))
        return route.fulfill({ json: { draft: saved } });
      if (request.method() !== "DELETE")
        expect(body.expectedRevision).toBe(saved.revision);
      saved.revision++;
      if (path.endsWith("/intents")) {
        const id = crypto.randomUUID();
        uploads.set(id, body);
        saved.attachments.transfers.push(
          transfer({
            id,
            attachmentId: id,
            kind: body.kind,
            name: body.name,
            size: body.size,
            status: "pending",
            replacesId: body.replacesId ?? null,
            requiresReselection: false,
          }),
        );
        publish();
        return route.fulfill({
          json: {
            draft: saved,
            transfer: {
              id,
              upload: {
                method: "PUT",
                url: `https://api.lulu.test/mock-upload/${id}`,
                headers: {},
              },
            },
          },
        });
      }
      if (request.method() === "PATCH" && path === `${root}/attachments`) {
        if (body.photoOrder) saved.attachments.photoOrder = body.photoOrder;
        if (body.primaryPhotoId)
          saved.attachments.primaryPhotoId = body.primaryPhotoId;
      } else if (
        request.method() === "DELETE" &&
        /^.*\/attachments\/[0-9a-f-]{36}$/.test(path)
      ) {
        const id = path.split("/").at(-1);
        saved.attachments.photos = saved.attachments.photos.filter(
          (value) => value.id !== id,
        );
        saved.attachments.photoOrder = saved.attachments.photoOrder.filter(
          (value) => value !== id,
        );
      } else throw Error(`Unexpected mocked attachment request ${path}`);
      publish();
      await route.fulfill({ json: { draft: saved } });
    },
  );
  await page.route("https://api.lulu.test/mock-upload/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    const input = uploads.get(id);
    if (!input) throw Error("Unknown mock upload");
    expect(route.request().method()).toBe("PUT");
    expect(route.request().postDataBuffer()?.length).toBe(input.size);
    const file = photo({
      id,
      assetId: id,
      name: input.name,
      size: input.size,
      kind: input.kind,
      imageUrl: input.kind === "photo" ? image : null,
      contentType:
        input.kind === "photo" ? "image/png" : "application/octet-stream",
      publicFileServiceId: input.kind === "print" ? id : null,
    });
    if (input.kind === "photo") {
      saved.attachments.photos = saved.attachments.photos.filter(
        (value) => value.id !== input.replacesId,
      );
      saved.attachments.photos.push(file);
      saved.attachments.photoOrder = input.replacesId
        ? saved.attachments.photoOrder.map((value) =>
            value === input.replacesId ? id : value,
          )
        : [...saved.attachments.photoOrder, id];
    } else saved.attachments.printFile = file;
    const pending = saved.attachments.transfers.find(
      (value) => value.id === id,
    );
    if (!pending) throw Error("Missing mock transfer");
    pending.status = "saved";
    saved.revision++;
    publish();
    await route.fulfill({
      json: input.kind === "photo" ? { draft: saved } : {},
    });
  });
  await page.goto("/admin/products");
  await page.getByRole("button", { name: "Edit draft facts" }).click();
  const list = page.getByRole("list", { name: "Draft attachments" });
  const row = (name: string) =>
    list.getByRole("listitem").filter({ hasText: name });
  await row("retained-one.png")
    .getByRole("button", { name: "Move later" })
    .focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => saved.attachments.photoOrder)
    .toEqual([otherPhotoId, photoId]);
  expect(saved.attachments.primaryPhotoId).toBe(photoId);
  const add = page.getByLabel("Product photos (up to 5)", { exact: true });
  await expect(add).toBeEnabled();
  await add.setInputFiles({
    name: "added.png",
    mimeType: "image/png",
    buffer: Buffer.from("mock photo"),
  });
  await expect(list).toContainText("added.png");
  await row("retained-two.png")
    .getByRole("button", { name: "Replace", exact: true })
    .click();
  await page
    .getByLabel("Replacement / reselected photo", { exact: true })
    .setInputFiles({
      name: "replacement.png",
      mimeType: "image/png",
      buffer: Buffer.from("mock replacement"),
    });
  await expect(list).toContainText("replacement.png");
  await row("replacement.png")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(list).not.toContainText("replacement.png");
  await row("added.png").getByRole("button", { name: "Make primary" }).click();
  await expect(row("added.png")).toContainText("Primary photo");
  await expect(page.getByLabel("Print file", { exact: true })).toBeEnabled();
  await page.getByLabel("Print file", { exact: true }).setInputFiles({
    name: "updated.stl",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("solid mock\nendsolid mock"),
  });
  await expect(list).toContainText("updated.stl");
  await page.reload();
  await page.getByRole("button", { name: "Edit draft facts" }).click();
  await expect(row("added.png")).toContainText("Primary photo");
  await expect(list).toContainText("retained-one.png");
  await expect(list).toContainText("updated.stl");
  for (const img of await list.getByRole("img").all())
    await img.evaluate((element: HTMLImageElement) => element.decode());
  expect(api.requests.some((request) => request.endsWith("/submit"))).toBe(
    false,
  );
  await checkLayout(page);
});
