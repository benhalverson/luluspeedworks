import {
  draft,
  draftId,
  otherId,
  photoId,
  transferId,
} from "../admin-fixtures";
import {
  mutationResult,
  operationId,
  preparation,
  preparationId,
} from "../admin-mutation-fixtures";
import { apiPage } from "../catalog-fixtures";
import { checkLayout, draftList, expect, test } from "./fixtures";

test("restored deletion shows identity, cancels without a write, and rejects stale confirmation", async ({
  page,
  api,
}) => {
  const image = "https://api.lulu.test/delete-photo.png";
  await page.route(image, (route) =>
    route.fulfill({
      contentType: "image/png",
      headers: {
        "Access-Control-Allow-Origin": "http://127.0.0.1:4173",
        "Access-Control-Allow-Credentials": "true",
      },
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4AWJ6tVXjPwgzMUABAAAA//8Lw1LcAAAABklEQVQDAEt4BZFa6totAAAAAElFTkSuQmCC",
        "base64",
      ),
    }),
  );
  const saved = draft({
    target: { kind: "existing", productId: 42 },
    context: {
      status: "available",
      product: {
        id: 42,
        name: "Prepared part",
        description: "Physical RC part",
        image,
        price: 15,
        filamentType: "PLA",
        color: "Red",
        skuNumber: "SKU-42",
        publicFileServiceId: "file-42",
      },
      categories: [],
    },
  });
  const prepared = preparation("delete");
  if (!prepared.snapshot) throw Error("Expected snapshot");
  prepared.snapshot.image = image;
  const root = `/admin/product-drafts/${draftId}`;
  api.responses.set("GET /admin/product-drafts", { body: draftList(saved) });
  api.responses.set(`GET ${root}`, { body: saved });
  api.responses.set(`GET ${root}/preparation`, {
    body: { preparation: prepared },
  });
  api.responses.set(`POST ${root}/pricing/prepare`, {
    body: { preparation: prepared },
  });
  api.responses.set(`POST ${root}/submit`, {
    status: 409,
    body: { error: "Product changed since review" },
  });
  await page.goto("/admin/products");
  const confirmation = page.getByRole("region", {
    name: "Confirm product deletion",
  });
  await expect(confirmation).toContainText("Delete Prepared part?");
  await expect(confirmation).toContainText("SKU SKU-42");
  await expect(confirmation.getByRole("img")).toBeVisible();
  expect(api.requests.filter((x) => x.startsWith("POST"))).toEqual([]);
  const cancel = page.getByRole("button", { name: "Cancel deletion" });
  await cancel.focus();
  await page.keyboard.press("Enter");
  await expect(confirmation).toHaveCount(0);
  expect(api.requests.filter((x) => x.startsWith("POST"))).toEqual([]);
  await page.reload();
  await expect(confirmation).toBeVisible();
  expect(api.requests.filter((x) => x.startsWith("POST"))).toEqual([]);
  await page
    .getByRole("button", { name: "Delete product", exact: true })
    .click();
  await expect(page.getByText(/outcome is unresolved/).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete product", exact: true }),
  ).toBeDisabled();
  expect(api.requests.filter((x) => x === `POST ${root}/submit`)).toHaveLength(
    1,
  );
  expect(api.requests.filter((x) => x.endsWith("/reconcile"))).toEqual([]);
  await checkLayout(page);
});

test("deletion refreshes a rejected review and retains the listing until verified local deletion", async ({
  page,
  api,
}) => {
  const saved = draft({
    target: { kind: "existing", productId: 42 },
    context: {
      status: "available",
      product: {
        id: 42,
        name: "Prepared part",
        description: "Physical RC part",
        image: null,
        price: 15,
        filamentType: "PLA",
        color: "Red",
        skuNumber: "SKU-42",
        publicFileServiceId: "file-42",
      },
      categories: [],
    },
  });
  const root = `/admin/product-drafts/${draftId}`;
  const original = preparation("delete");
  if (!original.snapshot) throw Error("Expected snapshot");
  original.snapshot.image = "";
  const fresh = preparation("delete", {
    id: otherId,
    snapshot: {
      ...original.snapshot,
      name: "Revised part",
      productRevision: 2,
    },
  });
  api.responses.set("GET /admin/product-drafts", { body: draftList(saved) });
  api.responses.set(`GET ${root}`, { body: saved });
  api.responses.set(`GET ${root}/preparation`, {
    body: { preparation: original },
  });
  api.responses.set(`POST ${root}/pricing/prepare`, {
    body: { preparation: fresh },
  });
  api.responses.set(`POST ${root}/submit`, {
    status: 409,
    body: { error: "catalog_changed_retry" },
  });
  const catalog = apiPage([42]);
  catalog.products = catalog.products.map((product) => ({
    ...product,
    image: "",
    name: "Listed part",
  }));
  api.responses.set("GET /products", { body: catalog });
  api.responses.set("GET /product/42", {
    body: { ...catalog.products[0], categories: [] },
  });
  const submissions: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(`${root}/submit`))
      submissions.push(request.postDataJSON());
  });
  await page.goto("/admin/products");
  const submit = page.getByRole("button", {
    name: "Delete product",
    exact: true,
  });
  await expect(submit).toBeEnabled();
  if (saved.context.status !== "available") throw Error("Expected product");
  saved.context.product.name = "Revised part";
  saved.context.product.skuNumber = "SKU-42-V2";
  await submit.focus();
  await page.keyboard.press("Enter");
  const review = page.getByRole("button", { name: "Review product deletion" });
  await expect(review).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Revised part", level: 1 }),
  ).toBeVisible();
  await expect(submit).toBeDisabled();
  expect(submissions).toEqual([
    { expectedRevision: 1, preparationId, action: "delete" },
  ]);
  await review.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Confirm product deletion" }),
  ).toContainText("SKU SKU-42-V2");
  await expect(submit).toBeEnabled();
  expect(submissions).toHaveLength(1);
  const result = mutationResult("delete", {
    product: null,
    readiness: null,
    storefrontVisible: false,
  });
  if (!result.operation) throw Error("Expected operation");
  const operation = { ...result.operation, preparationId: otherId };
  const states = [
    "pending",
    "square_confirmed",
    "repair_required",
    "succeeded",
  ] as const;
  let stage = 0;
  const cleanup = [
    {
      id: photoId,
      assetId: photoId,
      status: "pending",
      reason: "Provider deletion unavailable",
    },
    {
      id: transferId,
      assetId: transferId,
      status: "protected",
      reason: "Retained by an order",
    },
  ];
  const response = () => ({
    ...result,
    operation: {
      ...operation,
      state: states[Math.min(stage, 3)],
      error: stage === 2 ? "Local deletion unavailable" : null,
      cleanup: stage >= 3 ? cleanup : [],
    },
  });
  const reconciliations: unknown[] = [];
  await page.route(`https://api.lulu.test${root}/submit`, async (route) => {
    api.responses.set(`GET ${root}/operation`, { body: response() });
    api.responses.set(`GET ${root}/preparation`, {
      body: { preparation: fresh },
    });
    await route.fulfill({ json: response() });
  });
  await page.route(`https://api.lulu.test${root}/reconcile`, async (route) => {
    reconciliations.push(route.request().postDataJSON());
    stage++;
    if (stage >= 3) {
      saved.context = { status: "unavailable", productId: 42 };
      api.responses.set("GET /products", { body: apiPage([]) });
    }
    if (stage === 4)
      cleanup[0] = {
        id: photoId,
        assetId: photoId,
        status: "deleted",
        reason: "Unreferenced file removed",
      };
    api.responses.set(`GET ${root}/operation`, { body: response() });
    await route.fulfill({ json: response() });
  });
  await submit.focus();
  await page.keyboard.press("Enter");
  const check = page.getByRole("button", { name: "Check product operation" });
  for (const notice of [
    "Square unpublication is pending.",
    "Square unpublished. Local product deletion is pending.",
    "Local deletion unavailable",
  ]) {
    await expect(
      page.getByRole("status", { name: "Draft status" }),
    ).toContainText(notice);
    await expect(
      page.getByRole("region", { name: "Product completion" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Products", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Listed part" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Conversations", exact: true })
      .click();
    await check.click();
  }
  await expect(
    page.getByRole("region", { name: "Product completion" }),
  ).toContainText("Product deleted.");
  await expect(page.getByRole("region", { name: "Product Card" })).toHaveCount(
    0,
  );
  await expect(page.getByText(/Product #42 is unavailable/)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Product operation cleanup" }),
  ).toContainText("File cleanup pending: Provider deletion unavailable");
  await page.getByRole("button", { name: "Products", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Listed part" })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Conversations", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Product completion" }),
  ).toBeVisible();
  await expect(page.getByLabel("Product notes")).toBeDisabled();
  expect(submissions).toHaveLength(2);
  expect(reconciliations).toHaveLength(3);
  await check.focus();
  await page.keyboard.press("Enter");
  const cleanupRegion = page.getByRole("region", {
    name: "Product operation cleanup",
  });
  await expect(cleanupRegion).toContainText(
    "File deleted: Unreferenced file removed",
  );
  await expect(cleanupRegion).toContainText(
    "Referenced file retained: Retained by an order",
  );
  expect(submissions).toEqual([
    { expectedRevision: 1, preparationId, action: "delete" },
    { expectedRevision: 1, preparationId: otherId, action: "delete" },
  ]);
  expect(reconciliations).toEqual(
    Array.from({ length: 4 }, () => ({ operationId })),
  );
  await checkLayout(page);
});
