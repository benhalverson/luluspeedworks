import { expect, it, vi } from "vitest";
import {
  categoriesSchema,
  completeCatalog,
  imageUrl,
  pageSchema,
  request,
} from "../src/storefront/api";
import { apiPage, categories } from "./catalog-fixtures";

it.each([null, undefined, "", "bad", "https://", "javascript:alert(1)"])(
  "uses an image fallback for %s",
  (value) => expect(imageUrl(value)).toBe(""),
);
it("allows HTTP images", () =>
  expect(imageUrl("http://localhost/test.png")).toBe(
    "http://localhost/test.png",
  ));
it("validates completeness independently of pagination flags and arithmetic", () => {
  expect(completeCatalog(categories, [])).toBeUndefined();
  const page = apiPage([1]);
  const repeatedCategory = categories
    .slice(0, 1)
    .concat(categories.slice(0, 1));
  expect(
    completeCatalog(categories, [apiPage([1], 1, 1, repeatedCategory)])
      ?.products[0],
  ).toMatchObject({ price: 2.29, currency: "USD", categoryIds: [1] });
  expect(completeCatalog(categories, [apiPage([])])?.products).toEqual([]);
  expect(
    completeCatalog(categories, [apiPage([1], 1, 1, [])])?.products[0]
      ?.categoryIds,
  ).toEqual([]);
  expect(
    completeCatalog(categories, [
      {
        ...page,
        pagination: {
          ...page.pagination,
          limit: 50,
          hasNextPage: true,
          hasPreviousPage: true,
        },
      },
    ]),
  ).toBeDefined();
  for (const change of [{ page: 2 }, { totalPages: 2 }, { totalItems: 2 }]) {
    expect(
      completeCatalog(categories, [
        { ...page, pagination: { ...page.pagination, ...change } },
      ]),
    ).toBeUndefined();
  }
  const second = apiPage([2], 2, 2);
  const first = {
    ...page,
    pagination: { ...page.pagination, totalPages: 2, totalItems: 2 },
  };
  expect(completeCatalog(categories, [first, second])).toBeUndefined();
  expect(
    completeCatalog(categories, [
      first,
      { ...second, pagination: { ...second.pagination, totalPages: 2 } },
    ])?.products,
  ).toHaveLength(2);
  expect(
    completeCatalog(categories, [
      first,
      {
        ...second,
        pagination: { ...second.pagination, totalPages: 2, totalItems: 3 },
      },
    ]),
  ).toBeUndefined();
  expect(completeCatalog(categories, [apiPage([1, 1])])).toBeUndefined();
  expect(completeCatalog(repeatedCategory, [page])).toBeUndefined();
  expect(
    completeCatalog(categories, [
      apiPage([1], 1, 1, [{ categoryId: 99, categoryName: "Unknown" }]),
    ]),
  ).toBeUndefined();
});

it.each([
  undefined,
  null,
  {},
  [{ categoryId: "1", categoryName: "RC Parts" }],
  [{ categoryId: 1 }],
])("rejects malformed list category membership %j", (membership) => {
  const page = apiPage([1]);
  expect(
    pageSchema.safeParse({
      ...page,
      products: [{ ...page.products[0], categories: membership }],
    }).success,
  ).toBe(false);
});

it("preserves both USD channel prices and ordered category identities from list items", () => {
  const page = apiPage([1, 2]);
  const parsed = pageSchema.parse({
    ...page,
    products: [
      {
        ...page.products[0],
        price: 12.34,
        inPersonPrice: 9.75,
        categories: [...categories].reverse(),
      },
      { ...page.products[1], price: 5.5, inPersonPrice: null, categories: [] },
    ],
  });
  expect(completeCatalog(categories, [parsed])?.products).toMatchObject([
    {
      id: 1,
      price: 12.34,
      inPersonPrice: 9.75,
      currency: "USD",
      categoryIds: [2, 1],
    },
    {
      id: 2,
      price: 5.5,
      inPersonPrice: null,
      currency: "USD",
      categoryIds: [],
    },
  ]);
});
it("clears request timers and propagates cancellation", async () => {
  const controller = new AbortController();
  const error = new DOMException("aborted", "AbortError");
  vi.mocked(fetch).mockRejectedValue(error);
  controller.abort();
  await expect(
    request(
      "https://api.example.com",
      "/categories",
      categoriesSchema,
      controller.signal,
    ),
  ).rejects.toBe(error);
});
