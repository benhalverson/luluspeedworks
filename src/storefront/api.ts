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

export class CatalogFailure extends Error {
  constructor(public readonly kind: "malformed" | "unavailable" | "timeout") {
    super(kind);
  }
}

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
): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 10_000);
  try {
    const response = await fetch(new URL(path, origin), {
      credentials: "omit",
      signal: AbortSignal.any([signal, timeout.signal]),
    });
    if (!response.ok) throw new CatalogFailure("unavailable");
    return schema.parse(await response.json());
  } catch (error) {
    if (signal.aborted) throw error;
    if (timeout.signal.aborted) throw new CatalogFailure("timeout");
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      throw new CatalogFailure("malformed");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCatalog(
  origin: string,
  signal: AbortSignal,
): Promise<CatalogSnapshot> {
  const [categories, first] = await Promise.all([
    request(origin, "/categories", categoriesSchema, signal),
    request(origin, "/products?page=1&limit=100", pageSchema, signal),
  ]);
  const categoryIds = new Set(
    categories.map((category) => category.categoryId),
  );
  if (categoryIds.size !== categories.length)
    throw new CatalogFailure("malformed");
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
      throw new CatalogFailure("malformed");
    for (const product of page.products) {
      if (seen.has(product.id)) throw new CatalogFailure("malformed");
      seen.add(product.id);
      const detail = await request(
        origin,
        `/product/${product.id}`,
        detailSchema,
        signal,
      );
      if (
        detail.id !== product.id ||
        detail.categories.some(
          (category) => !categoryIds.has(category.categoryId),
        )
      )
        throw new CatalogFailure("malformed");
      products.push({
        ...product,
        image: imageUrl(product.image),
        currency: "USD",
        categoryIds: [
          ...new Set(detail.categories.map((category) => category.categoryId)),
        ],
      });
    }
    if (number < totalPages)
      page = await request(
        origin,
        `/products?page=${number + 1}&limit=100`,
        pageSchema,
        signal,
      );
  }
  return { categories, products };
}
