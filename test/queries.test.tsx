import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { App } from "../src/App";
import { surfaceId } from "../src/storefront/messages";
import { apiPage, categories, mockCatalog } from "./catalog-fixtures";
import { renderWithClient, testClient } from "./query-client";

function pendingRequests() {
  const pending = new Map<
    string,
    {
      resolve: (response: Response) => void;
      reject: (error: Error) => void;
      signal: AbortSignal | null | undefined;
    }
  >();
  vi.mocked(fetch).mockImplementation(
    (input, init) =>
      new Promise((resolve, reject) => {
        pending.set(
          new URL(String(input)).pathname + new URL(String(input)).search,
          { resolve, reject, signal: init?.signal },
        );
      }),
  );
  return pending;
}

it("loads a large catalog from roots and concurrent pages, publishes an ordered snapshot without detail requests", async () => {
  const pending = pendingRequests();
  renderWithClient(<App />);
  expect([...pending.keys()]).toEqual([
    "/categories",
    "/products?page=1&limit=100",
  ]);
  await act(async () => {
    pending.get("/products?page=1&limit=100")?.resolve(
      Response.json(
        apiPage(
          Array.from({ length: 100 }, (_, i) => i + 1),
          1,
          201,
        ),
      ),
    );
  });
  await waitFor(() =>
    expect(pending.has("/products?page=3&limit=100")).toBe(true),
  );
  expect(pending.has("/products?page=2&limit=100")).toBe(true);
  await act(async () => {
    pending
      .get("/products?page=3&limit=100")
      ?.resolve(Response.json(apiPage([201], 3, 201)));
  });
  expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  await act(async () => {
    pending.get("/products?page=2&limit=100")?.resolve(
      Response.json(
        apiPage(
          Array.from({ length: 100 }, (_, i) => i + 101),
          2,
          201,
        ),
      ),
    );
  });
  expect(
    [...pending.keys()].filter((key) => key.startsWith("/product/")),
  ).toHaveLength(0);
  expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  await act(async () =>
    pending.get("/categories")?.resolve(Response.json(categories)),
  );
  await screen.findByText("Part 1");
  expect(screen.getAllByRole("listitem")).toHaveLength(10);
  expect(
    screen.getByRole("status", { name: "Catalog status" }),
  ).toHaveTextContent("201 products");
  for (let page = 2; page <= 21; page++)
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Part 201")).toBeVisible();
  expect(screen.getByText("$2.29")).toBeVisible();
  expect(
    [...pending.keys()].filter((path) => !path.startsWith("/api/auth/")),
  ).toEqual([
    "/categories",
    "/products?page=1&limit=100",
    "/products?page=2&limit=100",
    "/products?page=3&limit=100",
  ]);
});

it("reuses the five-minute cache, disables automatic refetch, and isolates every resource by origin", async () => {
  const client = testClient();
  const fetcher = mockCatalog(1);
  const first = renderWithClient(<App />, client);
  await screen.findByText("Part 1");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    client
      .getQueryCache()
      .getAll()
      .filter((query) => query.queryKey[0] === "catalog")
      .every((query) => query.gcTime === 300_000),
  ).toBe(true);
  first.unmount();
  const second = renderWithClient(<App />, client);
  await screen.findByText("Part 1");
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  vi.stubEnv("VITE_API_ORIGIN", "https://other.example.com");
  second.rerender(<App />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
  await screen.findByText("Part 1");
  expect(
    client.getQueryCache().findAll({ queryKey: ["catalog"] }),
  ).toHaveLength(4);
  expect(
    fetcher.mock.calls
      .slice(2)
      .every(
        ([input, init]) =>
          new URL(String(input)).origin === "https://other.example.com" &&
          init?.credentials === "omit",
      ),
  ).toBe(true);
});

it.each(["page", "categories"])(
  "hides partial results after a %s failure and retries from page one with fresh memberships",
  async (failure) => {
    const fetcher = mockCatalog(101);
    const original = fetcher.getMockImplementation();
    fetcher.mockImplementation((input, init) => {
      if (String(input).includes(failure === "page" ? "page=2" : "/categories"))
        return Promise.resolve(new Response(null, { status: 503 }));
      if (!original) throw new Error("Missing fixture");
      return original(input, init);
    });
    renderWithClient(<App />);
    await screen.findByText("Catalog unavailable. Please retry.");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    const refreshed = mockCatalog(1, categories.slice(1));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Part 1");
    expect(
      refreshed.mock.calls.map(
        ([input]) =>
          new URL(String(input)).pathname + new URL(String(input)).search,
      ),
    ).toEqual(["/categories", "/products?page=1&limit=100"]);
    fireEvent.click(screen.getByRole("button", { name: "RC Parts" }));
    expect(
      screen.getByRole("status", { name: "Catalog status" }),
    ).toHaveTextContent("No products in RC Parts.");
  },
);

it.each(["inconsistent", "json", "membership"])(
  "distinguishes %s responses",
  async (kind) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(categories))
      .mockResolvedValueOnce(
        kind === "json"
          ? new Response("{")
          : Response.json({
              ...apiPage([1]),
              products: [
                {
                  ...apiPage([1]).products[0],
                  categories:
                    kind === "membership"
                      ? undefined
                      : [{ categoryId: 99, categoryName: "Unknown" }],
                },
              ],
            }),
      );
    renderWithClient(<App />);
    await screen.findByText(
      kind === "inconsistent"
        ? "Catalog changed while loading. Please retry."
        : "Malformed catalog response. Please retry.",
    );
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  },
);

it("cancels retry and unmount requests and ignores obsolete completions and unknown actions", async () => {
  const process = vi.spyOn(MessageProcessor.prototype, "processMessages");
  const pending = pendingRequests();
  const view = renderWithClient(<App />);
  const processor = process.mock.instances[0];
  if (!(processor instanceof MessageProcessor))
    throw new Error("Missing processor");
  const surface = processor.model.getSurface(surfaceId);
  if (!surface) throw new Error("Missing surface");
  mockCatalog(1);
  await act(async () => {
    await surface.dispatchAction({ event: { name: "unknown" } }, "products");
    await surface.dispatchAction({ event: { name: "retry" } }, "products");
  });
  await screen.findByText("Part 1");
  expect(
    [...pending.values()].every((request) => request.signal?.aborted),
  ).toBe(true);
  await act(async () => {
    pending.get("/categories")?.resolve(Response.json([]));
    pending
      .get("/products?page=1&limit=100")
      ?.reject(new Error("Late failure"));
  });
  expect(screen.getByText("Part 1")).toBeVisible();
  const late = pendingRequests();
  await act(async () => {
    await surface.dispatchAction({ event: { name: "retry" } }, "products");
  });
  view.unmount();
  expect([...late.values()].every((request) => request.signal?.aborted)).toBe(
    true,
  );
  await act(async () => {
    late.get("/categories")?.reject(new Error("After unmount"));
    late.get("/products?page=1&limit=100")?.resolve(Response.json(apiPage([])));
  });
});
