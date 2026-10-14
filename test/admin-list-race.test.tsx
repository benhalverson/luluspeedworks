import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { draft, otherId } from "./admin-fixtures";
import { apiPage, categories } from "./catalog-fixtures";
import { renderWithClient, testClient } from "./query-client";

vi.mock("../src/storefront/auth", async (original) => {
  const actual = await original<typeof import("../src/storefront/auth")>();
  return {
    ...actual,
    authClient: {
      useSession: () => ({
        data: { user: { id: "admin" } },
        isPending: false,
        error: null,
      }),
    },
  };
});
const listKey = ["admin-drafts", "https://api.luluspeedworks.com", "admin"];
const accessKey = ["admin-draft-access", ...listKey.slice(1)];
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/admin/products");
});

it.each(["create", "discard"] as const)(
  "preserves an acknowledged %s across an older list response, then accepts a fresh list",
  async (operation) => {
    const original = draft();
    const {
      state: _state,
      context: _context,
      attachments: _attachments,
      ...summary
    } = original;
    const client = testClient();
    let release: ((response: Response) => void) | undefined;
    let defer = false;
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/admin/product-drafts") {
        if (defer)
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        return Response.json({ drafts: [summary] });
      }
      if (path.endsWith("/preparation"))
        return Response.json({ preparation: null });
      if (path.endsWith("/operation"))
        return Response.json({
          operation: null,
          product: null,
          readiness: null,
          storefrontVisible: false,
        });
      if (path.startsWith("/admin/product-drafts/"))
        return Response.json(original);
      if (path === "/categories") return Response.json(categories);
      return Response.json(apiPage([]));
    });
    renderWithClient(<App />, client);
    await screen.findByRole(
      "button",
      { name: "Edit draft facts" },
      { timeout: 5000 },
    );
    defer = true;
    void client.invalidateQueries({ queryKey: accessKey, exact: true });
    await waitFor(() => expect(release).toBeDefined());
    const acknowledged = draft({
      id: operation === "create" ? otherId : original.id,
      revision: 2,
      status: operation === "discard" ? "discarded" : "active",
    });
    // Exercise the list cache boundary used by acknowledged server mutations.
    const expected = {
      drafts: operation === "create" ? [acknowledged, summary] : [acknowledged],
    };
    act(() => client.setQueryData(listKey, expected));
    await act(async () => release?.(Response.json({ drafts: [summary] })));
    await waitFor(() =>
      expect(client.isFetching({ queryKey: accessKey })).toBe(0),
    );
    expect(client.getQueryData(listKey)).toEqual(expected);
    release = undefined;
    void client.invalidateQueries({ queryKey: accessKey, exact: true });
    await waitFor(() => expect(release).toBeDefined());
    await act(async () => release?.(Response.json({ drafts: [] })));
    await waitFor(() =>
      expect(client.isFetching({ queryKey: accessKey })).toBe(0),
    );
    expect(client.getQueryData(listKey)).toEqual({ drafts: [] });
  },
);

it.each(["create", "discard"] as const)(
  "keeps the rendered %s acknowledgement when an earlier list GET finishes",
  async (operation) => {
    const original = draft({
      target: { kind: "existing", productId: 2 },
      state: {
        answers: { name: "Original product" },
        history: [],
        pendingQuestions: [],
      },
    });
    const {
      state: _state,
      context: _context,
      attachments: _attachments,
      ...summary
    } = original;
    const client = testClient();
    const reads: ((response: Response) => void)[] = [];
    let defer = false;
    const created = draft({ id: otherId });
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      const method = init?.method ?? "GET";
      if (path === "/admin/product-drafts") {
        if (method === "POST") return Response.json(created);
        if (defer)
          return new Promise<Response>((resolve) => reads.push(resolve));
        return Response.json({ drafts: [summary] });
      }
      if (path.endsWith("/preparation"))
        return Response.json({ preparation: null });
      if (path.endsWith("/operation"))
        return Response.json({
          operation: null,
          product: null,
          readiness: null,
          storefrontVisible: false,
        });
      if (path.startsWith("/admin/product-drafts/")) {
        if (method === "DELETE")
          return Response.json({
            id: original.id,
            revision: 2,
            status: "discarded",
            cleanup: [],
          });
        return Response.json(path.endsWith(otherId) ? created : original);
      }
      if (path === "/categories") return Response.json(categories);
      return Response.json(apiPage([]));
    });
    renderWithClient(<App />, client);
    await screen.findByRole(
      "button",
      { name: "Edit draft facts" },
      { timeout: 5000 },
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Original product",
    );
    defer = true;
    void client.invalidateQueries({ queryKey: accessKey, exact: true });
    await waitFor(() => expect(reads).toHaveLength(1));
    fireEvent.click(
      screen.getByRole("button", {
        name: operation === "create" ? "+ New product" : "Discard draft",
      }),
    );
    if (operation === "create") {
      await screen.findByRole("button", { name: "Save draft answers" });
      const recent = within(screen.getByRole("complementary"));
      expect(
        recent.getByRole("button", { name: /New product/ }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "New product",
      );
      expect(screen.getByLabelText("Product name")).toHaveValue("");
      expect(client.isFetching({ queryKey: accessKey })).toBe(1);
      await act(async () => reads[0]?.(Response.json({ drafts: [summary] })));
      await waitFor(() =>
        expect(client.isFetching({ queryKey: accessKey })).toBe(0),
      );
      expect(recent.getAllByRole("button")).toHaveLength(2);
      expect(
        recent.getByRole("button", { name: /New product/ }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        recent.getByRole("button", { name: /Product #2/ }),
      ).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "New product",
      );
      expect(screen.getByLabelText("Product name")).toHaveValue("");
      expect(
        client
          .getQueryData<{ drafts: { id: string }[] }>(listKey)
          ?.drafts.map((item) => item.id),
      ).toContain(otherId);
    } else {
      await waitFor(() => expect(reads).toHaveLength(2));
      await act(async () => reads[1]?.(Response.json({ drafts: [] })));
      await screen.findByText(
        "Draft discarded. Referenced files and submitted operations are retained.",
      );
      await act(async () => reads[0]?.(Response.json({ drafts: [summary] })));
      expect(
        within(screen.getByRole("complementary")).queryByRole("button", {
          name: /Product #2/,
        }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Discard draft" }),
      ).toBeNull();
      expect(client.getQueryData(listKey)).toEqual({ drafts: [] });
    }
  },
);

it("preserves a saved revision and rendered detail across an older list response, then reconciles a fresh list", async () => {
  const original = draft({
    state: {
      answers: { name: "Original product" },
      history: [],
      pendingQuestions: [],
    },
  });
  const {
    state: _state,
    context: _context,
    attachments: _attachments,
    ...summary
  } = original;
  const saved = draft({
    revision: 2,
    updatedAt: 2,
    state: {
      ...original.state,
      answers: { name: "Saved product" },
    },
  });
  const savedSummary = {
    ...summary,
    revision: saved.revision,
    updatedAt: saved.updatedAt,
  };
  const client = testClient();
  const reads: ((response: Response) => void)[] = [];
  let defer = false;
  const prepare = vi.fn((init: RequestInit | undefined) => {
    expect(JSON.parse(String(init?.body))).toMatchObject({
      expectedRevision: 1,
      answers: { name: "Saved product" },
    });
    return Response.json(saved);
  });
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? "GET";
    if (path === "/admin/product-drafts" && method === "GET") {
      if (defer) return new Promise<Response>((resolve) => reads.push(resolve));
      return Response.json({ drafts: [summary] });
    }
    if (
      path === `/admin/product-drafts/${original.id}/prepare` &&
      method === "POST"
    )
      return prepare(init);
    if (path.endsWith("/preparation") || path.endsWith("/pricing/prepare"))
      return Response.json({ preparation: null });
    if (path.endsWith("/operation"))
      return Response.json({
        operation: null,
        product: null,
        readiness: null,
        storefrontVisible: false,
      });
    if (path === `/admin/product-drafts/${original.id}` && method === "GET")
      return Response.json(original);
    if (path === "/categories") return Response.json(categories);
    if (path === "/products") return Response.json(apiPage([]));
    throw new Error(`Unexpected ${method} ${path}`);
  });
  renderWithClient(<App />, client);
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit draft facts" }),
  );
  defer = true;
  void client.invalidateQueries({ queryKey: accessKey, exact: true });
  await waitFor(() => expect(reads).toHaveLength(1));
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Saved product" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft answers" }));
  await screen.findByText("Draft answers saved. No catalog changes were made.");
  expect(prepare).toHaveBeenCalledOnce();
  expect(client.isFetching({ queryKey: accessKey })).toBe(1);
  expect(client.getQueryData(listKey)).toMatchObject({
    drafts: [savedSummary],
  });
  await act(async () => reads[0]?.(Response.json({ drafts: [summary] })));
  await waitFor(() =>
    expect(client.isFetching({ queryKey: accessKey })).toBe(0),
  );
  expect(client.getQueryData(listKey)).toMatchObject({
    drafts: [savedSummary],
  });
  expect(client.getQueryData([...listKey, original.id])).toEqual(saved);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Saved product",
  );
  expect(
    within(screen.getByRole("complementary")).getByRole("button", {
      name: /New product/,
    }),
  ).toHaveAttribute("aria-pressed", "true");

  void client.invalidateQueries({ queryKey: accessKey, exact: true });
  await waitFor(() => expect(reads).toHaveLength(2));
  await act(async () => reads[1]?.(Response.json({ drafts: [] })));
  await waitFor(() =>
    expect(client.isFetching({ queryKey: accessKey })).toBe(0),
  );
  expect(client.getQueryData(listKey)).toEqual({ drafts: [] });
  expect(
    screen.getByText("Select a product or start a new product conversation."),
  ).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Saved product" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Discard draft" })).toBeNull();
  expect(
    within(screen.getByRole("complementary")).queryByRole("button"),
  ).toBeNull();
  expect(prepare).toHaveBeenCalledOnce();
});

it("finishes a pending discard safely when its list cache has been cleared", async () => {
  const original = draft();
  const {
    state: _state,
    context: _context,
    attachments: _attachments,
    ...summary
  } = original;
  const client = testClient();
  let release: ((response: Response) => void) | undefined;
  let discarded = false;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/admin/product-drafts")
      return Response.json({ drafts: discarded ? [] : [summary] });
    if (path.endsWith("/preparation"))
      return Response.json({ preparation: null });
    if (path.endsWith("/operation"))
      return Response.json({
        operation: null,
        product: null,
        readiness: null,
        storefrontVisible: false,
      });
    if (path.startsWith("/admin/product-drafts/")) {
      if (init?.method === "DELETE")
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      return Response.json(original);
    }
    if (path === "/categories") return Response.json(categories);
    return Response.json(apiPage([]));
  });
  renderWithClient(<App />, client);
  await screen.findByRole(
    "button",
    { name: "Edit draft facts" },
    { timeout: 5000 },
  );
  fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
  await waitFor(() => expect(release).toBeDefined());
  act(() => client.removeQueries({ queryKey: listKey, exact: true }));
  expect(client.getQueryData(listKey)).toBeUndefined();
  discarded = true;
  await act(async () =>
    release?.(
      Response.json({
        id: original.id,
        revision: 2,
        status: "discarded",
        cleanup: [],
      }),
    ),
  );
  await screen.findByText(
    "Draft discarded. Referenced files and submitted operations are retained.",
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    within(screen.getByRole("complementary")).queryByRole("button", {
      name: /New product/,
    }),
  ).toBeNull();
  expect(client.getQueryData(listKey)).toEqual({ drafts: [] });
});
