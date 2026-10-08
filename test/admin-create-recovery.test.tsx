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
  "recovers a lost creation response by its retained key (previous draft: %s)",
  async (hasPreviousDraft) => {
    const drafts: ProductDraft[] = hasPreviousDraft ? [draft()] : [];
    let creations = 0;
    let requestKey = "";
    const recovered = draft({
      id: otherId,
      state: {
        answers: { name: "Recovered conversation" },
        history: [],
        pendingQuestions: [],
      },
    });
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/categories") return Response.json(categories);
      if (url.pathname === "/products") return Response.json(apiPage([1, 2]));
      if (url.pathname === "/admin/product-drafts") {
        if (init?.method === "POST") {
          creations++;
          const body = JSON.parse(String(init.body));
          requestKey = body.requestKey;
          expect(
            JSON.parse(
              localStorage.getItem(
                "lulu-admin-create-v1:https://api.luluspeedworks.com:admin",
              ) ?? "null",
            ),
          ).toEqual(body);
          drafts.push(recovered);
          throw new Error("Creation response lost");
        }
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
      if (url.pathname === `/admin/product-drafts/by-request-key/${requestKey}`)
        return Response.json(recovered);
      const saved = drafts.find(
        (item) => url.pathname === `/admin/product-drafts/${item.id}`,
      );
      if (saved) return Response.json(saved);
      return Response.json({ error: "Unexpected request" }, { status: 404 });
    });
    renderWithClient(<App />);
    const create = await screen.findByRole("button", { name: "+ New product" });
    if (hasPreviousDraft)
      await screen.findByRole("button", { name: "Edit draft facts" });
    fireEvent.click(create);
    await screen.findByText("The original conversation has been recovered.");
    await screen.findAllByText("Recovered conversation");
    expect(create).toBeEnabled();
    expect(creations).toBe(1);
    expect(
      localStorage.getItem(
        "lulu-admin-create-v1:https://api.luluspeedworks.com:admin",
      ),
    ).toBe("null");
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
  "preserves authorization and creation uncertainty when correlated recovery fails (%s)",
  async (status) => {
    let lostResponse = false;
    let failList = true;
    let creations = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/categories") return Response.json(categories);
      if (url.pathname === "/products") return Response.json(apiPage([1, 2]));
      if (url.pathname.startsWith("/admin/product-drafts/by-request-key/"))
        return Response.json(
          { error: "Recovery unavailable" },
          { status: failList ? status : 404 },
        );
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
      await screen.findByText(/No conversation was found for this request/);
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

it.each(["found", "retry", "retry lost", "discarded", "unavailable"])(
  "resumes persisted creation through the workspace: %s",
  async (outcome) => {
    const key = "lulu-admin-create-v1:https://api.luluspeedworks.com:admin";
    const stored = {
      requestKey: "11111111-1111-4111-8111-111111111111",
      target: { kind: "new" },
    };
    localStorage.setItem(key, JSON.stringify(stored));
    const writes: unknown[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/categories") return Response.json(categories);
      if (path === "/products") return Response.json(apiPage([1]));
      if (path === "/admin/product-drafts" && init?.method === "POST") {
        writes.push(JSON.parse(String(init.body)));
        if (outcome === "retry lost") throw Error("Lost retry acknowledgement");
        return Response.json(draft());
      }
      if (path === "/admin/product-drafts")
        return Response.json({ drafts: [] });
      if (path.includes("/by-request-key/"))
        return outcome === "found" || writes.length > 0
          ? Response.json(draft())
          : Response.json(
              {},
              {
                status: outcome.startsWith("retry")
                  ? 404
                  : outcome === "discarded"
                    ? 410
                    : 503,
              },
            );
      return Response.json(draft());
    });
    renderWithClient(<App />);
    const create = await screen.findByRole("button", { name: "+ New product" });
    expect(create).toBeDisabled();
    expect(writes).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Reload saved state" }));
    if (outcome.startsWith("retry")) {
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Retry this conversation request",
        }),
      );
      await screen.findByText("The original conversation has been recovered.");
      expect(writes).toEqual([stored]);
    } else if (outcome === "discarded")
      await screen.findByText(
        "That conversation was discarded. You can start a new one.",
      );
    else if (outcome === "found")
      await screen.findByText("The original conversation has been recovered.");
    else {
      await screen.findByText(/Keep this request and check again/);
      expect(create).toBeDisabled();
      expect(localStorage.getItem(key)).toBe(JSON.stringify(stored));
      return;
    }
    expect(create).toBeEnabled();
    expect(localStorage.getItem(key)).toBe("null");
  },
);
