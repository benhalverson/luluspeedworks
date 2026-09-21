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

export function imageUrl(value: string | null | undefined): string {
  return value && /^https?:\/\//i.test(value) && URL.canParse(value)
    ? value
    : "";
}
/**
 * Fetches and validates a catalog response for TanStack Query's query functions.
 * Omits credentials, rejects unsuccessful HTTP responses, parses the body with
 * Zod, and combines TanStack's cancellation signal with a ten-second timeout.
 * TanStack Query owns loading state, errors, caching, and retry behavior.
 */
export async function request<T>(
  origin: string,
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new Error("Catalog request timed out. Please retry.")),
    10_000,
  );
  try {
    const response = await fetch(new URL(path, origin), {
      credentials: "omit",
      signal: AbortSignal.any([signal, timeout.signal]),
    });
    if (!response.ok) throw new Error("Catalog unavailable. Please retry.");
    return schema.parse(await response.json());
  } catch (error) {
    if (timeout.signal.aborted) throw timeout.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
export { categoriesSchema, detailSchema, pageSchema };
export type ProductPage = z.infer<typeof pageSchema>;
export type ProductDetail = z.infer<typeof detailSchema>;

export function completeCatalog(
  categories: CatalogSnapshot["categories"],
  pages: ProductPage[],
  details: ProductDetail[],
): CatalogSnapshot | undefined {
  const first = pages[0];
  if (!first) return undefined;
  const { totalItems, totalPages } = first.pagination;
  const products = pages.flatMap((page) => page.products);
  const categoryIds = new Set(
    categories.map((category) => category.categoryId),
  );
  if (
    pages.length !== Math.max(1, totalPages) ||
    pages.some(
      (page, index) =>
        page.pagination.page !== index + 1 ||
        page.pagination.totalItems !== totalItems ||
        page.pagination.totalPages !== totalPages,
    ) ||
    products.length !== totalItems ||
    new Set(products.map((product) => product.id)).size !== totalItems ||
    categoryIds.size !== categories.length ||
    details.length !== products.length ||
    details.some(
      (detail, index) =>
        detail.id !== products.at(index)?.id ||
        detail.categories.some(
          (category) => !categoryIds.has(category.categoryId),
        ),
    )
  )
    return undefined;
  return {
    categories,
    products: products.map((product, index) => ({
      ...product,
      image: imageUrl(product.image),
      currency: "USD",
      categoryIds: [
        ...new Set(
          details
            .slice(index, index + 1)
            .flatMap((detail) =>
              detail.categories.map((category) => category.categoryId),
            ),
        ),
      ],
    })),
  };
}
