import type { CatalogSnapshot } from "./api";

export const categoryNames = {
  all: "Shop all",
  rc: "RC Parts",
  pit: "Pit Tools",
};
export type Category = keyof typeof categoryNames;

export function browse(
  snapshot: CatalogSnapshot,
  category: Category,
  page: number,
) {
  const rc = snapshot.categories.filter(
    (item) => item.categoryName.trim().toLowerCase() === "rc parts",
  );
  const pit = snapshot.categories.filter((item) =>
    ["pit tools", "pit stuff"].includes(item.categoryName.trim().toLowerCase()),
  );
  const mappings =
    category === "all" ? [rc, pit] : [category === "rc" ? rc : pit];
  const available = mappings.every((mapping) => mapping.length === 1);
  const ids = new Set(mappings.flat().map((item) => item.categoryId));
  const products = available
    ? snapshot.products.filter((product) =>
        product.categoryIds.some((id) => ids.has(id)),
      )
    : [];
  const totalPages = Math.max(1, Math.ceil(products.length / 10));
  const currentPage = Math.max(1, Math.min(page, totalPages));
  return {
    available,
    entries: products.slice((currentPage - 1) * 10, currentPage * 10),
    count: products.length,
    page: currentPage,
    totalPages,
  };
}
