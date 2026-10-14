import type { MutationResult } from "../../src/admin/mutations";
import { draft, draftId, otherPhotoId, photoId } from "../admin-fixtures";
import {
  mutationResult,
  operationId,
  preparation,
} from "../admin-mutation-fixtures";
import { checkLayout, draftList, expect, test } from "./fixtures";

test("completed replacement retains its identity while explicit cleanup retries survive reload", async ({
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
        name: "Updated bracket",
        description: "Saved replacement",
        image: null,
        price: 3,
        inPersonPrice: 7.25,
        markupPercentage: 50,
        filamentType: "PLA",
        color: "Red",
        skuNumber: "BRACKET-42",
        publicFileServiceId: "replacement-file",
      },
      categories: [],
    },
  });
  let result: MutationResult = mutationResult("update");
  if (!result.operation || !result.product)
    throw Error("Expected result fixture");
  result.product = { ...result.product, price: 3, inPersonPrice: 7.25 };
  result.operation.cleanup = [photoId, otherPhotoId].map((id) => ({
    id,
    assetId: id,
    status: "pending",
    reason: "Provider deletion unavailable",
  }));
  api.responses.set("GET /admin/product-drafts", { body: draftList(saved) });
  api.responses.set(`GET ${root}`, { body: saved });
  api.responses.set(`GET ${root}/preparation`, {
    body: { preparation: preparation("update") },
  });
  api.responses.set(`GET ${root}/operation`, { body: result });
  const reconciliations: unknown[] = [];
  await page.route(`https://api.lulu.test${root}/reconcile`, async (route) => {
    reconciliations.push(route.request().postDataJSON());
    if (!result.operation) throw Error("Expected saved operation");
    result = {
      ...result,
      operation: {
        ...result.operation,
        cleanup:
          reconciliations.length === 1
            ? result.operation.cleanup.map((item) => ({
                ...item,
                reason: "Provider deletion still unavailable",
              }))
            : [
                {
                  id: photoId,
                  assetId: photoId,
                  status: "protected",
                  reason: "Retained by an order",
                },
                {
                  id: otherPhotoId,
                  assetId: otherPhotoId,
                  status: "deleted",
                  reason: null,
                },
              ],
      },
    };
    api.responses.set(`GET ${root}/operation`, { body: result });
    await route.fulfill({ json: result });
  });
  await page.goto("/admin/products");
  const completion = page.getByRole("region", { name: "Product completion" });
  const cleanup = completion.getByRole("region", {
    name: "Product operation cleanup",
  });
  const check = page.getByRole("button", { name: "Check product operation" });
  await expect(completion).toContainText("Product updated.");
  await expect(cleanup).toContainText(
    "File cleanup pending: Provider deletion unavailable",
  );
  await expect(completion).toContainText(
    "Online price: $3.00 · In-person price: $7.25",
  );
  expect(reconciliations).toEqual([]);
  await check.focus();
  await expect(check).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(cleanup).toContainText("Provider deletion still unavailable");
  await expect(check).toBeEnabled();
  await page.reload();
  await expect(cleanup).toContainText("Provider deletion still unavailable");
  expect(reconciliations).toEqual([{ operationId }]);
  await check.click();
  await expect(cleanup).toContainText(
    "Referenced file retained: Retained by an order",
  );
  await expect(cleanup).toContainText("File deleted");
  await expect(cleanup).not.toContainText("pending");
  await expect(check).toHaveCount(0);
  expect(reconciliations).toEqual([{ operationId }, { operationId }]);
  await page.reload();
  await expect(completion).toContainText("Product updated.");
  await expect(cleanup).toContainText(
    "Referenced file retained: Retained by an order",
  );
  await expect(cleanup).toContainText("File deleted");
  await expect(
    page.getByRole("heading", { name: "Updated bracket", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Product #42 · SKU BRACKET-42")).toBeVisible();
  await expect(page.getByRole("region", { name: "Product Card" })).toHaveCount(
    0,
  );
  await expect(check).toHaveCount(0);
  expect(reconciliations).toEqual([{ operationId }, { operationId }]);
  expect(api.requests.filter((request) => !request.startsWith("GET "))).toEqual(
    [],
  );
  await checkLayout(page);
});
