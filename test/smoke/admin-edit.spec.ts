import { draft, draftId, otherId } from "../admin-fixtures";
import {
  mutationResult,
  operationId,
  preparation,
  preparationId,
} from "../admin-mutation-fixtures";
import { checkLayout, draftList, expect, test } from "./fixtures";

test("an existing listing keeps its saved values until an explicitly confirmed update completes", async ({
  page,
  api,
}) => {
  const root = `/admin/product-drafts/${draftId}`;
  const categories = [
    { categoryId: 1, categoryName: "RC Parts" },
    { categoryId: 2, categoryName: "Pit Tools" },
  ];
  const product = {
    id: 42,
    name: "Existing gear holder",
    description: "Fits the current gear set",
    image: "http://127.0.0.1:4173/brand/lulu-logo.svg",
    price: 15,
    markupPercentage: 50,
    inPersonPrice: 12.75,
    filamentType: "PLA",
    color: "Red",
    skuNumber: "HOLDER-42",
    publicFileServiceId: "file-42",
  };
  let saved = draft({
    target: { kind: "existing", productId: 42 },
    context: { status: "available", product, categories },
    state: {
      answers: {},
      pendingQuestions: [],
      history: [{ role: "user", content: "Keep this gear holder compatible." }],
    },
  });
  const other = { ...product, id: 7, name: "Unrelated spacer", price: 3 };
  const otherDraft = draft({
    id: otherId,
    target: { kind: "existing", productId: 7 },
    context: { status: "available", product: other, categories },
  });
  const catalogPage = (current = product) => ({
    products: [current, other],
    pagination: {
      page: 1,
      limit: 100,
      totalItems: 2,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  });
  api.responses.set("GET /admin/product-drafts", {
    body: {
      drafts: [...draftList(saved).drafts, ...draftList(otherDraft).drafts],
    },
  });
  api.responses.set(`GET ${root}`, { body: saved });
  api.responses.set("GET /products", { body: catalogPage() });
  api.responses.set("GET /product/42", { body: { ...product, categories } });
  api.responses.set("GET /product/7", { body: { ...other, categories } });
  api.responses.set("GET /categories", { body: categories });

  const answers = {
    name: "Reviewed gear holder",
    description: product.description,
    markupPercentage: "50",
    inPersonPrice: "12.75",
    filamentType: "PLA",
    color: "Red",
    categoryIds: [1, 2],
  };
  const writes: { path: string; body: unknown }[] = [];
  const reviewed = preparation("update", { draftRevision: 2 });
  if (!reviewed.snapshot) throw Error("Expected update snapshot");
  reviewed.snapshot = {
    ...reviewed.snapshot,
    name: answers.name,
    description: product.description,
    categoryIds: [1, 2],
    categoryBindings: categories,
    image: product.image,
  };
  reviewed.pricing = {
    ...reviewed.pricing,
    productionCost: 12.42,
    onlinePrice: 18.63,
    inPersonPrice: 12.75,
  };
  const completed = mutationResult("update");
  if (!completed.product || !completed.operation)
    throw Error("Expected update outcome");
  completed.product = {
    ...completed.product,
    ...product,
    name: answers.name,
    price: 18.63,
  };
  const pending = {
    ...completed,
    operation: {
      ...completed.operation,
      state: "square_confirmed",
      retryable: true,
    },
    product: null,
    readiness: null,
    storefrontVisible: false,
  };
  await page.route(`https://api.lulu.test${root}/**`, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.fallback();
    const path = new URL(request.url()).pathname;
    const body = request.postDataJSON();
    writes.push({ path, body });
    if (path === `${root}/prepare`) {
      expect(body).toEqual({ expectedRevision: 1, answers });
      saved = draft({
        ...saved,
        revision: 2,
        state: { ...saved.state, answers },
      });
      api.responses.set(`GET ${root}`, { body: saved });
      return route.fulfill({ json: saved });
    }
    if (path === `${root}/pricing/prepare`) {
      expect(body).toEqual({ expectedRevision: 2, action: "update" });
      api.responses.set(`GET ${root}/preparation`, {
        body: { preparation: reviewed },
      });
      return route.fulfill({ json: { preparation: reviewed } });
    }
    if (path === `${root}/submit`) {
      expect(body).toEqual({
        expectedRevision: 2,
        preparationId,
        action: "update",
      });
      api.responses.set(`GET ${root}/operation`, { body: pending });
      return route.fulfill({ json: pending });
    }
    expect(path).toBe(`${root}/reconcile`);
    expect(body).toEqual({ operationId });
    // Only this controlled confirmation changes the mocked public catalog.
    // The browser exercises real A2UI bindings, not Square or persistence.
    const updated = { ...product, name: answers.name, price: 18.63 };
    saved = draft({
      ...saved,
      context: { status: "available", product: updated, categories },
    });
    api.responses.set(`GET ${root}`, { body: saved });
    api.responses.set(`GET ${root}/operation`, { body: completed });
    api.responses.set("GET /products", { body: catalogPage(updated) });
    api.responses.set("GET /product/42", { body: { ...updated, categories } });
    await route.fulfill({ json: completed });
  });

  await page.goto("/admin/products");
  await page.getByRole("button", { name: "Products", exact: true }).click();
  const listings = page.getByRole("region", { name: "Products", exact: true });
  const listing = listings.getByRole("button", { name: /Product #42/ });
  await expect(listing).toContainText("Existing gear holder");
  await expect(listing).toContainText("Online $15.00");
  await expect(listing).toContainText("In-person $12.75");
  await listing.focus();
  await expect(listing).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Edit draft facts" }).click();
  const card = page.getByRole("region", { name: "Product Card", exact: true });
  await expect(card).toHaveCount(1);
  const name = page.getByRole("textbox", { name: "Product name", exact: true });
  await expect(name).toHaveValue(product.name);
  await expect(page.getByLabel("Description", { exact: true })).toHaveCount(0);
  await name.fill(answers.name);
  await page.getByRole("button", { name: "Review product changes" }).click();
  const save = card.getByRole("button", { name: "Save changes", exact: true });
  await expect(save).toBeEnabled();
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Current catalog online price: $15.00");
  await expect(card).toContainText("Online markup: 50%");
  await expect(card).toContainText("Proposed online price: $18.63");
  await expect(card).toContainText("In-person price: $12.75");
  expect(writes.map(({ path }) => path)).toEqual([
    `${root}/prepare`,
    `${root}/pricing/prepare`,
  ]);
  await page.getByLabel("Product notes").fill("Keep this unsent follow-up.");
  await save.focus();
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(card).toContainText(
    "Square confirmed. Local catalog save is pending.",
  );
  await expect(save).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Product completion" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Products", exact: true }).click();
  await expect(listing).toContainText("Existing gear holder");
  await expect(listing).toContainText("Online $15.00");
  await expect(listing).toContainText("In-person $12.75");
  await page
    .getByRole("button", { name: "Conversations", exact: true })
    .click();
  const selected = page
    .getByRole("complementary", { name: "Recent conversations" })
    .getByRole("button", { name: /Product #42/ });
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Product notes")).toHaveValue(
    "Keep this unsent follow-up.",
  );
  const catalogReads = () =>
    api.requests.filter((request) => request === "GET /products").length;
  const readsBeforeConfirmation = catalogReads();
  await page.getByRole("button", { name: "Check product operation" }).click();
  const completion = page.getByRole("region", { name: "Product completion" });
  await expect(completion).toContainText("Product updated.");
  await expect(completion).toContainText("Online price: $18.63");
  await expect(completion).toContainText("In-person price: $12.75");
  await expect.poll(catalogReads).toBeGreaterThan(readsBeforeConfirmation);
  await expect(card).toHaveCount(0);
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Product notes")).toHaveValue(
    "Keep this unsent follow-up.",
  );
  await expect(
    page.getByRole("list", { name: "Conversation history" }),
  ).toContainText("Keep this gear holder compatible.");
  await page.getByRole("button", { name: "Products", exact: true }).click();
  await expect(listing).toContainText(answers.name);
  await expect(listing).toContainText("Online $18.63");
  await expect(listing).toContainText("In-person $12.75");
  await expect(
    listings.getByRole("button", { name: /Manage product/ }),
  ).toHaveCount(2);
  await expect(
    listings.getByRole("button", { name: /Product #7/ }),
  ).toContainText("Unrelated spacer");
  await expect(
    listings.getByRole("button", { name: /Product #7/ }),
  ).toContainText("Online $3.00");
  await page
    .getByRole("button", { name: "Conversations", exact: true })
    .click();
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await expect(completion).toBeVisible();
  expect(writes.map(({ path }) => path)).toEqual([
    `${root}/prepare`,
    `${root}/pricing/prepare`,
    `${root}/submit`,
    `${root}/reconcile`,
  ]);
  expect(
    api.requests.filter((request) => request === "POST /admin/product-drafts"),
  ).toEqual([]);
  await checkLayout(page);
});
