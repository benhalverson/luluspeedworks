import { expect, it } from "vitest";
import { browse } from "../src/storefront/controller";
import { categories, product } from "./catalog-fixtures";

const snapshot = {
  categories,
  products: Array.from({ length: 21 }, (_, i) => ({
    ...product(i + 1),
    currency: "USD" as const,
    categoryIds: [1, 2],
  })),
};
it("deduplicates the union, preserves order, and clamps both page boundaries", () => {
  expect(browse(snapshot, "all", 1)).toMatchObject({
    count: 21,
    page: 1,
    totalPages: 3,
  });
  expect(browse(snapshot, "all", 1).entries.map((entry) => entry.id)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ]);
  expect(browse(snapshot, "rc", -1).page).toBe(1);
  expect(browse(snapshot, "pit", 99).entries.map((entry) => entry.id)).toEqual([
    21,
  ]);
});
it("supports the future Pit Tools name and excludes uncategorized products", () => {
  expect(
    browse(
      {
        categories: [{ categoryId: 2, categoryName: " Pit Tools " }],
        products: [
          ...snapshot.products,
          { ...product(100), currency: "USD", categoryIds: [] },
        ],
      },
      "pit",
      1,
    ),
  ).toMatchObject({ available: true, count: 21 });
});
it("requires unique mappings, including both for Shop all", () => {
  const missing = { ...snapshot, categories: categories.slice(1) };
  expect(browse(missing, "rc", 1).available).toBe(false);
  expect(browse(missing, "all", 1).available).toBe(false);
  expect(browse(missing, "pit", 1).available).toBe(true);
  expect(
    browse(
      {
        ...snapshot,
        categories: [
          ...categories,
          { categoryId: 3, categoryName: "Pit Tools" },
        ],
      },
      "pit",
      1,
    ).available,
  ).toBe(false);
  expect(
    browse(
      {
        ...snapshot,
        categories: [
          ...categories,
          { categoryId: 3, categoryName: "rc parts" },
        ],
      },
      "rc",
      1,
    ).available,
  ).toBe(false);
});
