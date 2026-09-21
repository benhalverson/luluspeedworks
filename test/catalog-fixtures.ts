import { vi } from "vitest";

export const categories = [
  { categoryId: 1, categoryName: "RC Parts" },
  { categoryId: 2, categoryName: "Pit Stuff" },
];
export const product = (id = 1) => ({
  id,
  name: `Part ${id}`,
  description: `Description ${id}`,
  price: 2.29,
  image: "https://photos.example.com/part.png",
  categoryId: null,
});
export function apiPage(ids: number[], page = 1, totalItems = ids.length) {
  const totalPages = Math.ceil(totalItems / 100);
  return {
    products: ids.map(product),
    pagination: {
      page,
      limit: 100,
      totalItems,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}
export function mockCatalog(count = 12, membership = categories) {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/categories") return Response.json(categories);
    if (url.pathname === "/products") {
      const page = Number(url.searchParams.get("page"));
      return Response.json(
        apiPage(
          Array.from(
            { length: Math.min(100, count - (page - 1) * 100) },
            (_, i) => i + 1 + (page - 1) * 100,
          ),
          page,
          count,
        ),
      );
    }
    return Response.json({
      id: Number(url.pathname.split("/").at(-1)),
      categories: membership,
    });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
