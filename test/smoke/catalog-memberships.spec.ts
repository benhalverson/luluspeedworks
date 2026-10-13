import { checkLayout, deferred, expect, test } from "./fixtures";

const categories = [
  { categoryId: 1, categoryName: "RC Parts" },
  { categoryId: 2, categoryName: "Pit Tools" },
];

function product(id: number) {
  return {
    id,
    name: id === 1 ? "Smoke part" : `Catalog part ${id}`,
    description: `Local catalog description ${id}`,
    image: null,
    price: 2.29,
    inPersonPrice: 9.75,
    skuNumber: `SKU-${id}`,
    filamentType: "PLA",
    publicFileServiceId: "repeated-file-id",
    stl: `https://api.lulu.test/product/${id}/print-file`,
    categories: id === 101 ? [] : [categories[id % 2 ? 0 : 1]],
  };
}

function productPage(ids: number[], page = 1, totalItems = ids.length) {
  return {
    products: ids.map(product),
    pagination: {
      page,
      limit: 100,
      totalItems,
      totalPages: Math.ceil(totalItems / 100),
      hasNextPage: page * 100 < totalItems,
      hasPreviousPage: page > 1,
    },
  };
}

test("renders category memberships from pages while detail is stalled, then loads only the selected product", async ({
  page,
  api,
}) => {
  api.responses.set("GET /products?page=1&limit=100", {
    body: productPage(
      Array.from({ length: 100 }, (_, index) => index + 1),
      1,
      101,
    ),
  });
  api.responses.set("GET /products?page=2&limit=100", {
    body: productPage([101], 2, 101),
  });
  const detail = deferred<{ body: ReturnType<typeof product> }>();
  api.responses.set("GET /product/1", detail.promise);
  api.responses.set("GET /v2/colors", { body: { success: true, data: [] } });
  await page.goto("/");
  const status = page.getByRole("status", { name: "Catalog status" });
  await expect(status).toHaveText("Shop all: 101 products. Page 1 of 11.");
  expect(
    api.requests.filter((request) => request === "GET /products"),
  ).toHaveLength(2);
  expect(
    api.requests.filter((request) => request === "GET /categories"),
  ).toHaveLength(1);
  expect(
    api.requests.some((request) => request.startsWith("GET /product/")),
  ).toBe(false);
  await expect(page.getByRole("listitem")).toHaveCount(10);
  await expect(page.getByText("$2.29", { exact: true })).toHaveCount(10);
  const next = page.getByRole("button", { name: "Next" });
  await next.focus();
  await expect(next).toBeFocused();
  for (let index = 0; index < 10; index++) await next.click();
  await expect(
    page.getByRole("link", { name: "Catalog part 101" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pit Tools", exact: true }).click();
  await expect(status).toHaveText("Pit Tools: 50 products. Page 1 of 5.");
  await expect(
    page.getByRole("link", { name: "Catalog part 2", exact: true }),
  ).toBeVisible();
  await next.click();
  await expect(
    page.getByRole("link", { name: "Catalog part 22", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "RC Parts", exact: true }).click();
  await expect(status).toHaveText("RC Parts: 50 products. Page 1 of 5.");
  expect(
    api.requests.some((request) => request.startsWith("GET /product/")),
  ).toBe(false);
  await page.getByRole("link", { name: "Smoke part", exact: true }).click();
  await expect(page).toHaveURL(/\/products\/1$/);
  await expect(
    page.getByRole("heading", { name: "Loading product" }),
  ).toBeVisible();
  detail.resolve({ body: product(1) });
  await expect(
    page.getByRole("heading", { name: "Smoke part", exact: true, level: 1 }),
  ).toBeVisible();
  expect(
    api.requests.filter((request) => request.startsWith("GET /product/")),
  ).toEqual(["GET /product/1"]);
  await page.getByRole("link", { name: "Lulu Speedworks home" }).click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("link", { name: "Smoke part", exact: true }),
  ).toBeVisible();
  expect(
    api.requests.filter((request) => request === "GET /products"),
  ).toHaveLength(2);
  await checkLayout(page);
});

test("rejects unknown list category associations and retries fresh pages without detail requests", async ({
  page,
  api,
}) => {
  const invalid = productPage([1]);
  invalid.products = invalid.products.map((item) => ({
    ...item,
    categories: [{ categoryId: 99, categoryName: "Unknown" }],
  }));
  api.responses.set("GET /products", { body: invalid });
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Catalog status" })).toHaveText(
    "Catalog changed while loading. Please retry.",
  );
  await expect(page.getByRole("listitem")).toHaveCount(0);
  expect(
    api.requests.some((request) => request.startsWith("GET /product/")),
  ).toBe(false);
  api.responses.set("GET /products", { body: productPage([1]) });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Smoke part", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pit Tools", exact: true }).click();
  await expect(page.getByRole("status", { name: "Catalog status" })).toHaveText(
    "No products in Pit Tools.",
  );
  expect(
    api.requests.filter((request) => request === "GET /products"),
  ).toHaveLength(2);
  expect(
    api.requests.some((request) => request.startsWith("GET /product/")),
  ).toBe(false);
  await checkLayout(page);
});

test("renders an empty catalog with only its two metadata requests", async ({
  page,
  api,
}) => {
  api.responses.set("GET /products", { body: productPage([]) });
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Catalog status" })).toHaveText(
    "No products in Shop all.",
  );
  expect(api.requests).toEqual(
    expect.arrayContaining(["GET /categories", "GET /products"]),
  );
  expect(
    api.requests.filter((request) =>
      /^GET \/(?:products|categories|product\/)/.test(request),
    ),
  ).toHaveLength(2);
  await expect(page.getByRole("listitem")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await checkLayout(page);
});
