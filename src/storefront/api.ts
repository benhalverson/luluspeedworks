import { z } from "zod";

const id = z.number().int().positive();
const categorySchema = z.object({ categoryId: id, categoryName: z.string() });
const categoriesSchema = z.array(categorySchema);
const productSchema = z.object({
  id,
  name: z.string().min(1),
  description: z.string(),
  image: z.string().nullable().optional(),
  price: z.number().finite().nonnegative(),
});
const pageSchema = z.object({
  products: z.array(productSchema),
  pagination: z.object({
    page: id,
    limit: id,
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    hasNextPage: z.boolean(),
    hasPreviousPage: z.boolean(),
  }),
});
const detailSchema = z.object({ id, categories: categoriesSchema });
export const catalogProductSchema = productSchema.extend({
  image: z.string(),
  currency: z.literal("USD"),
  categoryIds: z.array(id),
});
export type CatalogProduct = z.infer<typeof catalogProductSchema>;
export type CatalogSnapshot = {
  categories: z.infer<typeof categoriesSchema>;
  products: CatalogProduct[];
};

type CatalogResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "malformed" | "unavailable" | "timeout" | "aborted" };

export function imageUrl(value: string | null | undefined): string {
  return value && /^https?:\/\//i.test(value) && URL.canParse(value)
    ? value
    : "";
}

async function request<T>(
  origin: string,
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<CatalogResult<T>> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 10_000);
  try {
    const response = await fetch(new URL(path, origin), {
      credentials: "omit",
      signal: AbortSignal.any([signal, timeout.signal]),
    });
    if (!response.ok) return { ok: false, kind: "unavailable" };
    const result = schema.safeParse(await response.json());
    return result.success
      ? { ok: true, value: result.data }
      : { ok: false, kind: "malformed" };
  } catch (error) {
    if (signal.aborted) return { ok: false, kind: "aborted" };
    if (timeout.signal.aborted) return { ok: false, kind: "timeout" };
    return {
      ok: false,
      kind: error instanceof SyntaxError ? "malformed" : "unavailable",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCatalog(
  origin: string,
  signal: AbortSignal,
): Promise<CatalogResult<CatalogSnapshot>> {
  const [categoryResult, pageResult] = await Promise.all([
    request(origin, "/categories", categoriesSchema, signal),
    request(origin, "/products?page=1&limit=100", pageSchema, signal),
  ]);
  if (!categoryResult.ok) return categoryResult;
  if (!pageResult.ok) return pageResult;
  const categories = categoryResult.value;
  const first = pageResult.value;
  const categoryIds = new Set(
    categories.map((category) => category.categoryId),
  );
  if (categoryIds.size !== categories.length)
    return { ok: false, kind: "malformed" };
  const { totalItems, totalPages } = first.pagination;
  const products: CatalogProduct[] = [];
  const seen = new Set<number>();
  let page = first;
  for (let number = 1; number <= Math.max(1, totalPages); number++) {
    const pagination = page.pagination;
    if (
      pagination.page !== number ||
      pagination.limit !== 100 ||
      pagination.totalItems !== totalItems ||
      pagination.totalPages !== totalPages ||
      totalPages !== Math.ceil(totalItems / 100) ||
      pagination.hasNextPage !== number < totalPages ||
      pagination.hasPreviousPage !== number > 1 ||
      page.products.length !== Math.min(100, totalItems - (number - 1) * 100)
    )
      return { ok: false, kind: "malformed" };
    for (const product of page.products) {
      if (seen.has(product.id)) return { ok: false, kind: "malformed" };
      seen.add(product.id);
      const detailResult = await request(
        origin,
        `/product/${product.id}`,
        detailSchema,
        signal,
      );
      if (!detailResult.ok) return detailResult;
      const detail = detailResult.value;
      if (
        detail.id !== product.id ||
        detail.categories.some(
          (category) => !categoryIds.has(category.categoryId),
        )
      )
        return { ok: false, kind: "malformed" };
      products.push({
        ...product,
        image: imageUrl(product.image),
        currency: "USD",
        categoryIds: [
          ...new Set(detail.categories.map((category) => category.categoryId)),
        ],
      });
    }
    if (number < totalPages) {
      const nextPage = await request(
        origin,
        `/products?page=${number + 1}&limit=100`,
        pageSchema,
        signal,
      );
      if (!nextPage.ok) return nextPage;
      page = nextPage.value;
    }
  }
  return { ok: true, value: { categories, products } };
}
