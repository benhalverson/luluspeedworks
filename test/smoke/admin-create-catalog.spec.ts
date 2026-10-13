import type { ProductPage } from "../../src/storefront/api";
import {
  draft,
  draftId,
  otherId,
  otherPhotoId,
  photo,
  photoId,
  transferId,
} from "../admin-fixtures";
import {
  mutationResult,
  preparation,
  preparationId,
} from "../admin-mutation-fixtures";
import { checkLayout, deferred, draftList, expect, test } from "./fixtures";

test("mocked product creation refreshes authoritative prices and the selected primary photo before catalog navigation", async ({
  page,
  api,
}) => {
  const root = `/admin/product-drafts/${draftId}`;
  const firstImage = "https://api.lulu.test/catalog/assets/first/image";
  const primaryImage = "https://api.lulu.test/catalog/assets/second/image";
  const saved = draft({
    state: {
      answers: {
        name: "Adjustable wing mount",
        description: "A printed RC wing mount",
        filamentType: "PLA",
        color: "Red",
        categoryIds: [1],
        markupPercentage: "50",
        inPersonPrice: "12.25",
      },
      pendingQuestions: [],
      history: [{ role: "user", content: "Create my adjustable wing mount." }],
    },
  });
  saved.attachments.photos = [
    photo({ name: "first.png", imageUrl: firstImage }),
    photo({
      id: otherPhotoId,
      assetId: otherPhotoId,
      name: "second.png",
      imageUrl: primaryImage,
    }),
  ];
  saved.attachments.photoOrder = [photoId, otherPhotoId];
  saved.attachments.primaryPhotoId = photoId;
  saved.attachments.printFile = photo({
    id: transferId,
    assetId: transferId,
    kind: "print",
    name: "part.stl",
    contentType: "application/octet-stream",
    imageUrl: null,
    publicFileServiceId: "file-42",
  });
  const prepared = preparation("create", { draftRevision: 2 });
  if (!prepared.snapshot) throw Error("Expected prepared product fixture");
  prepared.snapshot.name = saved.state.answers.name ?? "";
  prepared.snapshot.image = primaryImage;
  prepared.snapshot.imageGallery = [firstImage, primaryImage];
  prepared.snapshot.primaryPhotoAssetId = otherPhotoId;
  prepared.snapshot.assetIds = [photoId, otherPhotoId, transferId];
  prepared.pricing.productionCost = 13;
  prepared.pricing.onlinePrice = 19.5;
  prepared.pricing.inPersonPrice = 12.25;
  const result = mutationResult();
  if (!result.product) throw Error("Expected catalog product fixture");
  const product = {
    ...result.product,
    name: prepared.snapshot.name,
    image: primaryImage,
    imageGallery: JSON.stringify([firstImage, primaryImage]),
    price: 19.5,
    inPersonPrice: 12.25,
  };
  result.product = product;
  const catalogProduct = {
    ...product,
    categories: [{ categoryId: 1, categoryName: "RC Parts" }],
  };
  const catalogPage = (created: boolean): ProductPage => ({
    products: created ? [catalogProduct] : [],
    pagination: {
      page: 1,
      limit: 100,
      totalItems: created ? 1 : 0,
      totalPages: created ? 1 : 0,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  });
  api.responses.set("GET /admin/product-drafts", { body: draftList(saved) });
  api.responses.set(`GET ${root}`, { body: saved });
  api.responses.set("GET /products", { body: catalogPage(false) });
  api.responses.set("GET /product/42", {
    body: {
      ...product,
      categories: [{ categoryId: 1, categoryName: "RC Parts" }],
    },
  });
  await page.route("https://api.lulu.test/catalog/assets/*/image", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4AWJ6tVXjPwgzMUABAAAA//8Lw1LcAAAABklEQVQDAEt4BZFa6totAAAAAElFTkSuQmCC",
        "base64",
      ),
    }),
  );
  await page.route(
    `https://api.lulu.test${root}/attachments`,
    async (route) => {
      expect(route.request().method()).toBe("PATCH");
      expect(route.request().postDataJSON()).toEqual({
        expectedRevision: 1,
        primaryPhotoId: otherPhotoId,
      });
      saved.revision = 2;
      saved.attachments.primaryPhotoId = otherPhotoId;
      await route.fulfill({ json: { draft: saved } });
    },
  );
  await page.route(
    `https://api.lulu.test${root}/pricing/prepare`,
    async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({
        expectedRevision: 2,
        action: "create",
      });
      expect(saved.attachments.primaryPhotoId).toBe(otherPhotoId);
      api.responses.set(`GET ${root}/preparation`, {
        body: { preparation: prepared },
      });
      await route.fulfill({ json: { preparation: prepared } });
    },
  );
  const submissions: unknown[] = [];
  const completion = deferred<void>();
  await page.route(`https://api.lulu.test${root}/submit`, async (route) => {
    expect(route.request().method()).toBe("POST");
    submissions.push(route.request().postDataJSON());
    await completion.promise;
    // These HTTP fixtures model confirmed completion; no Square or DB runs here.
    api.responses.set(`GET ${root}/operation`, { body: result });
    api.responses.set("GET /products", { body: catalogPage(true) });
    await route.fulfill({ json: result });
  });
  const starts: unknown[] = [];
  await page.route(
    "https://api.lulu.test/admin/product-drafts",
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      starts.push(route.request().postDataJSON());
      const next = draft({ id: otherId });
      api.responses.set(`GET /admin/product-drafts/${otherId}`, { body: next });
      await route.fulfill({ json: next });
    },
  );

  await page.goto("/admin/products");
  await page.getByRole("button", { name: "Products", exact: true }).click();
  await expect(page.getByText("No catalog products yet.")).toBeVisible();
  await page
    .getByRole("button", { name: "Conversations", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit draft facts" }).click();
  const card = page.getByRole("region", { name: "Product Card" });
  await expect(card).toHaveCount(1);
  const photos = card.getByRole("list", { name: "Draft attachments" });
  await photos
    .getByRole("listitem")
    .filter({ hasText: "second.png" })
    .getByRole("button", { name: "Make primary" })
    .click();
  await expect(
    photos.getByRole("listitem").filter({ hasText: "second.png" }),
  ).toContainText("Primary photo");
  expect(saved.attachments.photoOrder).toEqual([photoId, otherPhotoId]);
  await page
    .getByRole("button", { name: "Review product changes", exact: true })
    .click();
  await expect(card).toContainText("Online price: $19.50");
  await expect(card).toContainText("In-person price: $12.25");
  const create = card.getByRole("button", {
    name: "Create product",
    exact: true,
  });
  await expect(create).toBeEnabled();
  expect(submissions).toEqual([]);
  const catalogReads = () =>
    api.requests.filter((request) => request === "GET /products").length;
  const readsBeforeCreate = catalogReads();
  await create.focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => submissions)
    .toEqual([{ expectedRevision: 2, preparationId, action: "create" }]);
  await expect(create).toBeDisabled();
  await page.keyboard.press("Enter");
  const summary = page.getByRole("region", { name: "Product completion" });
  await expect(summary).toHaveCount(0);
  await expect(card).toHaveCount(1);
  expect(catalogReads()).toBe(readsBeforeCreate);
  completion.resolve();
  await expect(summary).toContainText(
    "Product created. Visible in the storefront.",
  );
  await expect(summary).toContainText("Online price: $19.50");
  await expect(summary).toContainText("In-person price: $12.25");
  await expect(card).toHaveCount(0);
  // Opening Products refreshes too, so prove the mutation refreshed it first.
  await expect.poll(catalogReads).toBeGreaterThan(readsBeforeCreate);
  await expect(
    page.getByRole("region", { name: "Products", exact: true }),
  ).toHaveCount(0);
  const recent = page.getByRole("complementary", {
    name: "Recent conversations",
  });
  await expect(recent.getByRole("button", { pressed: true })).toHaveText(
    /New product/,
  );
  await expect(page.getByLabel("Product notes", { exact: true })).toBeEnabled();
  const newProduct = page.getByRole("button", {
    name: "+ New product",
    exact: true,
  });
  await expect(newProduct).toBeEnabled();
  expect(starts).toEqual([]);
  expect(submissions).toHaveLength(1);
  await checkLayout(page);

  await page.getByRole("button", { name: "Products", exact: true }).click();
  const listing = page
    .getByRole("region", { name: "Products", exact: true })
    .getByRole("button", { name: /Product #42 Adjustable wing mount/ });
  await expect(listing).toContainText("Online $19.50");
  await expect(listing).toContainText("In-person $12.25");
  const image = listing.locator("img");
  await expect(image).toHaveAttribute("src", primaryImage);
  await image.evaluate((element: HTMLImageElement) => element.decode());
  expect(
    await image.evaluate((element: HTMLImageElement) => element.naturalWidth),
  ).toBeGreaterThan(0);
  await checkLayout(page);
  await page
    .getByRole("button", { name: "Conversations", exact: true })
    .click();
  await expect(summary).toContainText("Adjustable wing mount");
  await expect(recent.getByRole("button", { pressed: true })).toHaveText(
    /New product/,
  );
  expect(saved.target).toEqual({ kind: "new" });
  expect(starts).toEqual([]);
  await newProduct.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Product name", { exact: true })).toHaveValue(
    "",
  );
  expect(starts).toEqual([
    { requestKey: expect.any(String), target: { kind: "new" } },
  ]);
  expect(submissions).toHaveLength(1);
});
