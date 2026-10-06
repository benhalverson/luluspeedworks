import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { ProductDraft } from "../src/admin/contracts";
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

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/admin/products");
});

it.each([false, true])(
  "keeps a lost creation response unresolved after successful reads (previous draft: %s)",
  async (hasPreviousDraft) => {
    const drafts: ProductDraft[] = hasPreviousDraft ? [draft()] : [];
    let creations = 0;
    let listReads = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/categories") return Response.json(categories);
      if (url.pathname === "/products") return Response.json(apiPage([1, 2]));
      if (url.pathname === "/admin/product-drafts") {
        if (init?.method === "POST") {
          creations++;
          // The server committed, but the client cannot correlate this list
          // entry with its lost POST response using the current API contract.
          drafts.push(draft({ id: otherId }));
          throw new Error("Creation response lost");
        }
        listReads++;
        return Response.json({
          drafts: drafts.map(
            ({
              state: _state,
              context: _context,
              attachments: _attachments,
              ...summary
            }) => summary,
          ),
        });
      }
      const saved = drafts.find(
        (item) => url.pathname === `/admin/product-drafts/${item.id}`,
      );
      if (saved) return Response.json(saved);
      return Response.json({ error: "Unexpected request" }, { status: 404 });
    });
    renderWithClient(<App />);
    const create = await screen.findByRole("button", {
      name: "+ New product",
    });
    if (hasPreviousDraft)
      await screen.findByRole("button", { name: "Edit draft facts" });
    fireEvent.click(create);
    await waitFor(() => expect(creations).toBe(1));
    await waitFor(() => {
      expect(
        screen.getByRole("status", { name: "Draft status" }),
      ).toHaveTextContent(/creation.*unresolved|unresolved.*creation/i);
    });
    expect(create).toBeDisabled();
    expect(
      screen.getByRole("status", { name: "Draft status" }),
    ).not.toHaveTextContent("Saved state has been reloaded");

    fireEvent.click(screen.getByRole("button", { name: "Reload saved state" }));
    await waitFor(() => expect(listReads).toBeGreaterThan(1));
    await waitFor(() => {
      expect(
        screen.getByRole("status", { name: "Draft status" }),
      ).toHaveTextContent(/creation.*unresolved|unresolved.*creation/i);
    });
    expect(create).toBeDisabled();
    expect(creations).toBe(1);
  },
);

it("recovers a failed dirty save before creation without claiming a creation was attempted", async () => {
  const saved = draft();
  let creations = 0;
  let saves = 0;
  const {
    state: _state,
    context: _context,
    attachments: _attachments,
    ...summary
  } = saved;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/categories") return Response.json(categories);
    if (url.pathname === "/products") return Response.json(apiPage([1, 2]));
    if (url.pathname === "/admin/product-drafts") {
      if (init?.method === "POST") {
        creations++;
        return Response.json(draft({ id: otherId }));
      }
      return Response.json({ drafts: [summary] });
    }
    if (url.pathname === `/admin/product-drafts/${saved.id}/prepare`) {
      saves++;
      throw new Error("Dirty save response lost");
    }
    if (url.pathname === `/admin/product-drafts/${saved.id}`)
      return Response.json(saved);
    return Response.json({ error: "Unexpected request" }, { status: 404 });
  });
  renderWithClient(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit draft facts" }),
  );
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Keep unsaved answers" },
  });
  fireEvent.click(screen.getByRole("button", { name: "+ New product" }));
  await waitFor(() => {
    expect(
      screen.getByRole("status", { name: "Draft status" }),
    ).toHaveTextContent("Saved state has been reloaded");
  });
  expect(screen.getByLabelText("Product name")).toHaveValue(
    "Keep unsaved answers",
  );
  expect(screen.getByRole("button", { name: "+ New product" })).toBeEnabled();
  expect(saves).toBe(1);
  expect(creations).toBe(0);
});

it.each([401, 403, 503])(
  "preserves authorization and creation uncertainty when recovery list fails (%s)",
  async (status) => {
    let lostResponse = false;
    let failList = true;
    let creations = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/categories") return Response.json(categories);
      if (url.pathname === "/products") return Response.json(apiPage([1, 2]));
      if (url.pathname !== "/admin/product-drafts")
        return Response.json({ error: "Unexpected request" }, { status: 404 });
      if (init?.method === "POST") {
        creations++;
        lostResponse = true;
        throw new Error("Creation response lost");
      }
      if (lostResponse && failList)
        return Response.json({ error: "Recovery unavailable" }, { status });
      return Response.json({ drafts: [] });
    });
    renderWithClient(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "+ New product" }),
    );
    if (status === 503) {
      await screen.findByText(/creation outcome is unresolved/);
      expect(
        screen.getByRole("button", { name: "+ New product" }),
      ).toBeDisabled();
      failList = false;
      fireEvent.click(
        screen.getByRole("button", { name: "Reload saved state" }),
      );
      await screen.findByText(/Saved conversations have been reloaded/);
      expect(
        screen.getByRole("button", { name: "+ New product" }),
      ).toBeDisabled();
    } else {
      await screen.findByRole("alert");
      expect(
        screen.queryByRole("button", { name: "+ New product" }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Reload saved state" }),
      ).toBeNull();
    }
    expect(creations).toBe(1);
  },
);

it.each([false, true])(
  "recovers a vanished saved draft through a fresh list (retry read also fails: %s)",
  async (retryReadFails) => {
    const saved = draft();
    const {
      state: _state,
      context: _context,
      attachments: _attachments,
      ...summary
    } = saved;
    let saveFailed = false;
    let removed = false;
    let failedListReads = 0;
    let writes = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/categories") return Response.json(categories);
      if (url.pathname === "/products") return Response.json(apiPage([1, 2]));
      if (init?.method === "POST") {
        writes++;
        saveFailed = true;
        return Response.json({ error: "Save unavailable" }, { status: 503 });
      }
      if (url.pathname === "/admin/product-drafts") {
        if (failedListReads > 0) {
          failedListReads--;
          return Response.json({ error: "List unavailable" }, { status: 503 });
        }
        return Response.json({ drafts: removed ? [] : [summary] });
      }
      if (!saveFailed && url.pathname === `/admin/product-drafts/${saved.id}`)
        return Response.json(saved);
      return Response.json({ error: "Draft unavailable" }, { status: 503 });
    });
    const client = testClient();
    renderWithClient(<App />, client);
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit draft facts" }),
    );
    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: "Pending answer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft answers" }));
    await screen.findByText(/saved outcome is unresolved/);

    // Another administrator removed this draft while its failed write was
    // being reconciled. Fresh authorization now lists no selected draft.
    removed = true;
    await act(() =>
      client.refetchQueries({ queryKey: ["admin-draft-access"] }),
    );
    await screen.findByText(
      "Select a product or start a new product conversation.",
    );
    failedListReads = 2;
    fireEvent.click(screen.getByRole("button", { name: "Reload saved state" }));
    await screen.findByText(/List unavailable The saved outcome is unresolved/);
    expect(
      screen.getByRole("button", { name: "+ New product" }),
    ).toBeDisabled();

    failedListReads = retryReadFails ? 1 : 0;
    fireEvent.click(screen.getByRole("button", { name: "Reload saved state" }));
    await screen.findByText(/Saved state (has been )?reloaded/);
    expect(screen.getByRole("button", { name: "+ New product" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Reload saved state" }),
    ).toBeNull();
    expect(writes).toBe(1);
  },
);
