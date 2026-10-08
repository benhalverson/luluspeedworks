import { draft, draftId } from "../admin-fixtures";
import { preparation } from "../admin-mutation-fixtures";
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
