import {
  queryOptions,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { z } from "zod";
import {
  categoriesSchema,
  completeCatalog,
  detailSchema,
  pageSchema,
  request,
} from "./api";

export const catalogQueryDefaults = {
  staleTime: Infinity,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export function useCatalog(origin: string) {
  const client = useQueryClient();
  const key = ["catalog", origin];
  const pageOptions = (page: number) =>
    queryOptions({
      ...catalogQueryDefaults,
      queryKey: [...key, "page", page],
      queryFn: ({ signal }) =>
        request(origin, `/products?page=${page}&limit=100`, pageSchema, signal),
    });
  const categories = useQuery({
    ...catalogQueryDefaults,
    queryKey: [...key, "categories"],
    queryFn: ({ signal }) =>
      request(origin, "/categories", categoriesSchema, signal),
  });
  const first = useQuery(pageOptions(1));
  const remaining = useQueries({
    queries: Array.from(
      { length: Math.max(0, (first.data?.pagination.totalPages ?? 1) - 1) },
      (_, index) => pageOptions(index + 2),
    ),
  });
  const pages = [first, ...remaining];
  const pageData = pages.flatMap((page) => (page.isSuccess ? [page.data] : []));
  const products = pages.every((page) => page.isSuccess)
    ? pageData.flatMap((page) => page.products)
    : [];
  const details = useQueries({
    queries: [...new Set(products.map((product) => product.id))].map((id) => ({
      ...catalogQueryDefaults,
      queryKey: [...key, "detail", id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        request(origin, `/product/${id}`, detailSchema, signal),
    })),
  });
  const queries = [categories, ...pages, ...details];
  const error = queries.find((query) => query.isError)?.error;
  const ready = queries.every((query) => query.isSuccess);
  const detailData = details.flatMap((detail) =>
    detail.isSuccess ? [detail.data] : [],
  );
  const snapshot =
    categories.isSuccess && ready
      ? completeCatalog(categories.data, pageData, detailData)
      : undefined;
  const status = error
    ? error instanceof z.ZodError || error instanceof SyntaxError
      ? "Malformed catalog response. Please retry."
      : error.message === "Catalog request timed out. Please retry."
        ? error.message
        : "Catalog unavailable. Please retry."
    : ready && !snapshot
      ? "Catalog changed while loading. Please retry."
      : "Loading catalog…";
  async function retry() {
    await client.cancelQueries({ queryKey: key });
    for (const query of client.getQueryCache().findAll({ queryKey: key }))
      query.reset();
    await client.refetchQueries({
      queryKey: key,
      predicate: (query) =>
        query.queryKey[2] === "categories" || query.queryKey[3] === 1,
    });
  }
  return {
    snapshot,
    status,
    failed: Boolean(error) || (ready && !snapshot),
    retry,
  };
}
