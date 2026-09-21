import { describe, expect, it, vi } from "vitest";
import { CatalogFailure, fetchCatalog, imageUrl } from "../src/storefront/api";
import { apiPage, categories, mockCatalog, product } from "./catalog-fixtures";

const origin = "https://api.example.com";
const read = () => fetchCatalog(origin, new AbortController().signal);

describe("catalog contract", () => {
  it("loads every page and authoritative multiple memberships without changing prices", async () => {
    const fetcher = mockCatalog(101);
    const result = await read();
    expect(result.products).toHaveLength(101);
    expect(result.products[100]).toEqual({
      id: 101,
      name: "Part 101",
      description: "Description 101",
      image: product().image,
      price: 2.29,
      currency: "USD",
      categoryIds: [1, 2],
    });
    expect(fetcher).toHaveBeenCalledWith(
      new URL(`${origin}/products?page=2&limit=100`),
      expect.objectContaining({ credentials: "omit" }),
    );
  });
  it("accepts an empty catalog", async () => {
    mockCatalog(0);
    expect((await read()).products).toEqual([]);
  });
  it.each([null, undefined, "", "bad", "https://", "javascript:alert(1)"])(
    "uses a neutral fallback for %s",
    (value) => expect(imageUrl(value)).toBe(""),
  );
  it("allows http images", () =>
    expect(imageUrl("http://localhost/test.png")).toBe(
      "http://localhost/test.png",
    ));
  it.each([
    { page: 2 },
    { limit: 50 },
    { totalPages: 3 },
    { totalItems: 2 },
    { hasNextPage: true },
    { hasPreviousPage: true },
  ])("rejects inconsistent pagination %j", async (change) => {
    const page = apiPage([1]);
    Object.assign(page.pagination, change);
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(categories))
      .mockResolvedValueOnce(Response.json(page));
    await expect(read()).rejects.toEqual(new CatalogFailure("malformed"));
  });
  it.each([{ totalItems: 102 }, { totalPages: 3 }, { page: 1 }])(
    "rejects changing later pages %j",
    async (change) => {
      const fetcher = mockCatalog(101);
      const original = fetcher.getMockImplementation();
      fetcher.mockImplementation(async (input, init) => {
        if (String(input).includes("page=2")) {
          const page = apiPage([101], 2, 101);
          Object.assign(page.pagination, change);
          return Response.json(page);
        }
        if (!original) throw new Error("Missing fixture");
        return original(input, init);
      });
      await expect(read()).rejects.toEqual(new CatalogFailure("malformed"));
    },
  );
  it("rejects repeated IDs instead of claiming completeness", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(categories))
      .mockResolvedValueOnce(Response.json(apiPage([1, 1])))
      .mockResolvedValueOnce(Response.json({ id: 1, categories }));
    await expect(read()).rejects.toEqual(new CatalogFailure("malformed"));
  });
  it.each([
    { id: 2, categories },
    { id: 1, categories: [{ categoryId: 99, categoryName: "Unknown" }] },
    { id: 1 },
  ])("rejects invalid detail membership %j", async (detail) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(categories))
      .mockResolvedValueOnce(Response.json(apiPage([1])))
      .mockResolvedValueOnce(Response.json(detail));
    await expect(read()).rejects.toEqual(new CatalogFailure("malformed"));
  });
  it("rejects duplicate category IDs", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json([categories[0], categories[0]]))
      .mockResolvedValueOnce(Response.json(apiPage([])));
    await expect(read()).rejects.toEqual(new CatalogFailure("malformed"));
  });
  it("deduplicates detail memberships and normalizes a missing image", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(categories))
      .mockResolvedValueOnce(
        Response.json({
          ...apiPage([1]),
          products: [{ ...product(), image: null }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ id: 1, categories: [categories[0], categories[0]] }),
      );
    expect((await read()).products[0]).toMatchObject({
      image: "",
      categoryIds: [1],
    });
  });
  it.each([
    [],
    { products: [{ ...product(), price: "2.29" }] },
    { error: "bad" },
  ])("rejects malformed bodies %j", async (body) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(categories))
      .mockResolvedValueOnce(Response.json(body));
    await expect(read()).rejects.toEqual(new CatalogFailure("malformed"));
  });
  it("rejects invalid JSON", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response("{"));
    await expect(read()).rejects.toEqual(new CatalogFailure("malformed"));
  });
  it("reports HTTP and network failures", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    await expect(read()).rejects.toEqual(new CatalogFailure("unavailable"));
    vi.mocked(fetch).mockRejectedValue(new TypeError("offline"));
    await expect(read()).rejects.toThrow("offline");
  });
  it("times out at ten seconds and clears its timers", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    const result = expect(read()).rejects.toEqual(
      new CatalogFailure("timeout"),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
  it("propagates cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.mocked(fetch).mockRejectedValue(
      new DOMException("aborted", "AbortError"),
    );
    await expect(fetchCatalog(origin, controller.signal)).rejects.toThrow(
      "aborted",
    );
  });
});
