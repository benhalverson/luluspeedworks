import { expect, it, vi } from "vitest";
import {
  categoriesSchema,
  completeCatalog,
  imageUrl,
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
  expect(completeCatalog(categories, [], [])).toBeUndefined();
  const page = apiPage([1]);
  const repeatedCategory = categories
    .slice(0, 1)
    .concat(categories.slice(0, 1));
  const detail = { id: 1, categories: repeatedCategory };
  expect(
    completeCatalog(categories, [page], [detail])?.products[0],
  ).toMatchObject({ price: 2.29, currency: "USD", categoryIds: [1] });
  expect(completeCatalog(categories, [apiPage([])], [])?.products).toEqual([]);
  expect(
    completeCatalog(
      categories,
      [
        {
          ...page,
          pagination: {
            ...page.pagination,
            limit: 50,
            hasNextPage: true,
            hasPreviousPage: true,
          },
        },
      ],
      [detail],
    ),
  ).toBeDefined();
  for (const change of [{ page: 2 }, { totalPages: 2 }, { totalItems: 2 }]) {
    expect(
      completeCatalog(
        categories,
        [{ ...page, pagination: { ...page.pagination, ...change } }],
        [detail],
      ),
    ).toBeUndefined();
  }
  const second = apiPage([2], 2, 2);
  const first = {
    ...page,
    pagination: { ...page.pagination, totalPages: 2, totalItems: 2 },
  };
  expect(completeCatalog(categories, [first, second], [])).toBeUndefined();
  expect(
    completeCatalog(
      categories,
      [
        first,
        {
          ...second,
          pagination: { ...second.pagination, totalPages: 2, totalItems: 3 },
        },
      ],
      [],
    ),
  ).toBeUndefined();
  expect(
    completeCatalog(categories, [apiPage([1, 1])], [detail, detail]),
  ).toBeUndefined();
  expect(completeCatalog(repeatedCategory, [page], [detail])).toBeUndefined();
  expect(completeCatalog(categories, [page], [])).toBeUndefined();
  expect(
    completeCatalog(categories, [page], [{ id: 2, categories }]),
  ).toBeUndefined();
  expect(
    completeCatalog(
      categories,
      [page],
      [{ id: 1, categories: [{ categoryId: 99, categoryName: "Unknown" }] }],
    ),
  ).toBeUndefined();
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
