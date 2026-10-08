import { draft, draftId, otherId } from "../admin-fixtures";
import { mutationResult, preparation } from "../admin-mutation-fixtures";
import { checkLayout, draftList, expect, test } from "./fixtures";

test("completed creation continues through lost conversation acknowledgement, reprices and explicitly updates the same product", async ({
  page,
  api,
}) => {
  const root = `/admin/product-drafts/${draftId}`;
  const nextRoot = `/admin/product-drafts/${otherId}`;
  const original = draft();
  let linked = draft({
    id: otherId,
    target: { kind: "existing", productId: 42 },
  });
  const result = mutationResult();
  api.responses.set("GET /admin/product-drafts", { body: draftList(original) });
  api.responses.set(`GET ${root}`, { body: original });
  api.responses.set(`GET ${root}/operation`, { body: result });
  api.responses.set(`GET ${root}/preparation`, {
    body: { preparation: preparation() },
  });
  let starts = 0;
  await page.route(
    "https://api.lulu.test/admin/product-drafts",
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      starts++;
      const body = route.request().postDataJSON();
      expect(body.target).toEqual({ kind: "existing", productId: 42 });
      api.responses.set(
        `GET /admin/product-drafts/by-request-key/${body.requestKey}`,
        { body: linked },
      );
      api.responses.set(`GET ${nextRoot}`, { body: linked });
      api.responses.set("GET /admin/product-drafts", {
        body: {
          drafts: [...draftList(linked).drafts, ...draftList(original).drafts],
        },
      });
      api.expectedNetworkErrors.set(
        route.request().url(),
        "Failed to load resource: net::ERR_FAILED",
      );
      await route.abort("failed");
    },
  );
  const priced = preparation("update", {
    id: otherId,
    draftRevision: 2,
    pricing: {
      ...preparation().pricing,
      markupPercentage: 75,
      onlinePrice: 17.5,
    },
  });
  await page.route(
    `https://api.lulu.test${nextRoot}/prepare`,
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        expectedRevision: 1,
        answers: {},
        message: "Use 75 percent online markup",
      });
      linked = draft({
        ...linked,
        revision: 2,
        state: {
          answers: { markupPercentage: "75", inPersonPrice: "12.00" },
          pendingQuestions: [],
          history: [{ role: "user", content: "Use 75 percent online markup" }],
        },
      });
      api.responses.set(`GET ${nextRoot}`, { body: linked });
      api.responses.set(`GET ${nextRoot}/preparation`, {
        body: { preparation: priced },
      });
      await route.fulfill({ json: linked });
    },
  );
  api.responses.set(`POST ${nextRoot}/pricing/prepare`, {
    body: { preparation: priced },
  });
  let updates = 0;
  await page.route(`https://api.lulu.test${nextRoot}/submit`, async (route) => {
    updates++;
    expect(route.request().postDataJSON()).toEqual({
      expectedRevision: 2,
      preparationId: otherId,
      action: "update",
    });
    const updated = mutationResult("update");
    if (!updated.operation || !updated.product)
      throw Error("Expected operation/product fixtures");
    updated.operation.draftId = otherId;
    updated.operation.preparationId = otherId;
    updated.product.price = 17.5;
    api.responses.set(`GET ${nextRoot}/operation`, { body: updated });
    await route.fulfill({ json: updated });
  });
  await page.goto("/admin/products");
  await expect(
    page.getByRole("region", { name: "Product completion" }),
  ).toContainText("Product created.");
  await expect(page.getByRole("region", { name: "Product Card" })).toHaveCount(
    0,
  );
  expect(starts).toBe(0);
  await page.getByLabel("Product notes").fill("Use 75 percent online markup");
  await page.getByRole("button", { name: "Send instruction" }).click();
  await expect(
    page.getByText("The original conversation has been recovered."),
  ).toBeVisible();
  await expect(page.getByLabel("Product notes")).toHaveValue(
    "Use 75 percent online markup",
  );
  expect(starts).toBe(1);
  expect(updates).toBe(0);
  await page.getByRole("button", { name: "Send instruction" }).click();
  const card = page.getByRole("region", { name: "Product Card" });
  await expect(card).toContainText("Proposed online price: $17.50");
  await expect(card).toContainText("In-person price: $12.00");
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  await expect(save).toBeEnabled();
  expect(updates).toBe(0);
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Product completion" }),
  ).toContainText("Product updated.");
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Product completion" }),
  ).toContainText("Online price: $17.50");
  await expect(
    page.getByRole("button", { name: "Edit product details" }),
  ).toBeVisible();
  expect(starts).toBe(1);
  expect(updates).toBe(1);
  await checkLayout(page);
});
