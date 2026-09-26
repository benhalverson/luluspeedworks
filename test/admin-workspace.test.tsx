import { SurfaceGroupModel, SurfaceModel } from "@a2ui/web_core/v0_9";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { ProductDraft } from "../src/admin/contracts";
import {
  draft,
  draftId,
  otherId,
  otherPhotoId,
  photo,
  photoId,
  transfer,
  transferId,
} from "./admin-fixtures";
import { apiPage, categories } from "./catalog-fixtures";
import { renderWithClient, testClient } from "./query-client";

const session = vi.hoisted(() => ({
  data: { user: { id: "admin" } } as { user: { id: string } } | null,
  isPending: false,
  error: null as Error | null,
}));
vi.mock("../src/storefront/auth", async (original) => {
  const actual = await original<typeof import("../src/storefront/auth")>();
  return { ...actual, authClient: { useSession: () => session } };
});
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected fixture");
  return value;
}
const current = () => required(drafts.at(0));
let drafts: ProductDraft[];
let requests: { path: string; method: string; body: Record<string, unknown> }[];
let override:
  | ((url: URL, init?: RequestInit) => Response | Promise<Response> | undefined)
  | undefined;
beforeEach(() => {
  session.data = { user: { id: "admin" } };
  session.isPending = false;
  session.error = null;
  localStorage.clear();
  window.history.replaceState(null, "", "/admin/products");
  drafts = [draft()];
  requests = [];
  override = undefined;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const custom = override?.(url, init);
    if (custom) return custom;
    if (url.pathname === "/categories") return Response.json(categories);
    if (url.pathname === "/products") return Response.json(apiPage([1, 2]));
    if (url.pathname.startsWith("/product/"))
      return Response.json({
        id: Number(url.pathname.split("/").at(-1)),
        categories,
      });
    const path = url.pathname.replace("/admin/product-drafts", "");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    requests.push({ path, method, body });
    if (!path && method === "GET")
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
    if (!path && method === "POST") {
      const created = draft({ id: otherId, target: body.target });
      drafts.push(created);
      return Response.json(created);
    }
    const current = drafts.find((item) => path.startsWith(`/${item.id}`));
    if (!current)
      return Response.json({ error: "Draft not found" }, { status: 404 });
    if (path.endsWith("/cleanup") || path.endsWith("/cleanup/retry"))
      return Response.json({
        id: current.id,
        revision: current.revision,
        status: current.status,
        cleanup: current.attachments.cleanup,
      });
    if (method === "GET")
      return current.status === "active"
        ? Response.json(current)
        : Response.json({ error: "Draft not found" }, { status: 404 });
    if (method === "PUT") {
      current.revision++;
      current.state = body.state;
      return Response.json(current);
    }
    if (method === "PATCH") {
      current.revision++;
      Object.assign(current.attachments, body);
      delete (current.attachments as unknown as Record<string, unknown>)
        .expectedRevision;
      return Response.json({ draft: current });
    }
    if (method === "DELETE" && path.includes("/attachments/")) {
      current.revision++;
      const deleted = path.split("/").at(-1);
      current.attachments.photos = current.attachments.photos.filter(
        (item) => item.id !== deleted,
      );
      current.attachments.photoOrder = current.attachments.photoOrder.filter(
        (id) => id !== deleted,
      );
      current.attachments.transfers = current.attachments.transfers.filter(
        (item) => item.attachmentId !== deleted,
      );
      if (current.attachments.printFile?.id === deleted)
        current.attachments.printFile = null;
      return Response.json({ draft: current });
    }
    if (method === "DELETE") {
      current.status = "discarded";
      return Response.json({
        id: current.id,
        revision: ++current.revision,
        status: "discarded",
        cleanup: current.attachments.cleanup,
      });
    }
    return Response.json({ error: "Unexpected request" }, { status: 400 });
  });
});
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const ready = () => screen.findByRole("button", { name: "Edit draft facts" });
const settled = () =>
  waitFor(() =>
    expect(screen.getByRole("button", { name: "Discard draft" })).toBeEnabled(),
  );

it("matches the storefront branding and navigates home", async () => {
  renderWithClient(<App />);
  await ready();
  const adminBrand = screen.getByRole("link", { name: "Lulu Speedworks home" });
  const adminMarkup = adminBrand.innerHTML;
  const adminClasses = adminBrand.className;

  fireEvent.click(adminBrand);

  expect(window.location.pathname).toBe("/");
  const storefrontBrand = screen.getByRole("link", {
    name: "Lulu Speedworks home",
  });
  expect(adminMarkup).toBe(storefrontBrand.innerHTML);
  expect(adminClasses).toBe(storefrontBrand.className);
});

it("keeps discarded cleanup, active editors and Recent selection together while retaining unsaved input", async () => {
  const second = draft({
    id: otherId,
    target: { kind: "existing", productId: 2 },
  });
  second.attachments.cleanup = [
    {
      id: photoId,
      assetId: photoId,
      status: "pending",
      reason: "Active cleanup",
    },
  ];
  drafts.push(
    second,
    draft({
      id: transferId,
      target: { kind: "existing", productId: 3 },
      status: "discarded",
      cleanupPending: true,
    }),
  );
  renderWithClient(<App />);
  await ready();
  click("Edit draft facts");
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Unsaved first product" },
  });
  fireEvent.change(screen.getByLabelText("Product notes"), {
    target: { value: "Unsent note" },
  });
  const recent = within(screen.getByRole("complementary"));
  fireEvent.click(recent.getByRole("button", { name: /Product #2/ }));
  await ready();
  expect(
    screen.getByText("File cleanup pending: Active cleanup"),
  ).toBeVisible();
  click("Edit draft facts");
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Unsaved second product" },
  });
  click("Products");
  await screen.findByLabelText("Search products");
  fireEvent.click(recent.getByRole("button", { name: /Product #3/ }));
  await screen.findByRole("heading", { name: "Draft discarded" });
  expect(screen.getByRole("heading", { name: "Product #3" })).toBeVisible();
  expect(recent.getByRole("button", { name: /Product #3/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(recent.getByRole("button", { name: /Product #2/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(screen.queryByLabelText("Product name")).toBeNull();
  expect(screen.queryByLabelText("Product notes")).toBeNull();
  expect(screen.queryByText("File cleanup pending: Active cleanup")).toBeNull();
  expect(screen.queryByLabelText("Search products")).toBeNull();
  expect(screen.getByText("File cleanup pending.")).toBeVisible();
  expect(screen.queryByText("No file cleanup pending.")).toBeNull();
  click("Retry cleanup");
  await screen.findByText("Cleanup state refreshed.");
  expect(requests.find((request) => request.method === "POST")).toMatchObject({
    path: `/${transferId}/cleanup/retry`,
    body: { expectedRevision: 1 },
  });
  fireEvent.click(recent.getByRole("button", { name: /Product #2/ }));
  expect(await screen.findByLabelText("Product name")).toHaveValue(
    "Unsaved second product",
  );
  expect(screen.queryByText("Draft discarded")).toBeNull();
  await settled();
  fireEvent.click(recent.getByRole("button", { name: /New product/ }));
  await waitFor(() =>
    expect(screen.getByLabelText("Product name")).toHaveValue(
      "Unsaved first product",
    ),
  );
  expect(screen.getByLabelText("Product notes")).toHaveValue("Unsent note");
  expect(requests.filter((request) => request.method === "PUT")).toHaveLength(
    0,
  );
});

it.each([false, true])(
  "keeps a discarded draft selected with another active draft (lost response: %s)",
  async (lost) => {
    drafts.push(
      draft({ id: otherId, target: { kind: "existing", productId: 2 } }),
    );
    if (lost)
      override = (_url, init) => {
        if (init?.method === "DELETE") {
          current().status = "discarded";
          return Response.json({ error: "Lost response" }, { status: 500 });
        }
      };
    renderWithClient(<App />);
    await ready();
    click("Discard draft");
    await screen.findByRole("heading", { name: "Draft discarded" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /New product.*Discarded/ }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(
      screen.queryByRole("button", { name: "Edit draft facts" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Product notes")).toBeNull();
    expect(screen.getByRole("button", { name: /Product #2/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Product #2/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Product #2/ }));
    await ready();
    expect(screen.queryByText("Draft discarded")).toBeNull();
  },
);

it.each(["active", "discarded"] as const)(
  "reloads %s cleanup flags without individual entries after retry",
  async (status) => {
    current().status = status;
    current().cleanupPending = true;
    override = (url, init) => {
      if (url.pathname.endsWith("/cleanup/retry")) {
        expect(JSON.parse(String(init?.body))).toEqual({ expectedRevision: 1 });
        current().cleanupPending = false;
        current().revision++;
        return Response.json({ id: draftId, revision: 2, status, cleanup: [] });
      }
    };
    renderWithClient(<App />);
    if (status === "discarded") {
      fireEvent.click(
        await screen.findByRole("button", { name: /New product.*Discarded/ }),
      );
    } else await ready();
    await screen.findByText("File cleanup pending.");
    expect(screen.queryByText("No file cleanup pending.")).toBeNull();
    click("Retry cleanup");
    await screen.findByText("Cleanup state refreshed.");
    expect(screen.queryByText("File cleanup pending.")).toBeNull();
    if (status === "active")
      expect(screen.queryByRole("region", { name: "File cleanup" })).toBeNull();
    else {
      expect(screen.getByText("No file cleanup pending.")).toBeVisible();
      expect(
        requests.filter((request) => request.path === `/${draftId}/cleanup`),
      ).toHaveLength(2);
    }
    expect(
      requests.filter(
        (request) =>
          request.path === (status === "active" ? `/${draftId}` : ""),
      ),
    ).toHaveLength(2);
  },
);

it("keeps retained references distinct from pending cleanup", async () => {
  current().attachments.cleanup = [
    {
      id: photoId,
      assetId: photoId,
      status: "protected",
      reason: "Catalog reference",
    },
  ];
  renderWithClient(<App />);
  await ready();
  expect(
    screen.getByText("Referenced file retained: Catalog reference"),
  ).toBeVisible();
  expect(screen.queryByText("File cleanup pending.")).toBeNull();
});

it.each(["network", "server", "malformed"])(
  "offers retry without permission wording for %s list failures",
  async (failure) => {
    override = (url) => {
      if (url.pathname !== "/admin/product-drafts") return;
      if (failure === "network")
        return Promise.reject(new TypeError("Failed to fetch"));
      return Response.json({}, { status: failure === "server" ? 503 : 200 });
    };
    renderWithClient(<App />);
    await screen.findByText("Private conversations unavailable. Please retry.");
    expect(screen.queryByText(/Administrator access is required/)).toBeNull();
    expect(
      screen.queryByRole("navigation", { name: "Admin navigation" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "+ New product" })).toBeNull();
    override = undefined;
    click("Retry conversations");
    await ready();
  },
);

it.each([401, 403])(
  "hides the workspace when the API denies access with %s",
  async (status) => {
    override = (url) =>
      url.pathname === "/admin/product-drafts"
        ? Response.json({ error: "Denied" }, { status })
        : undefined;
    renderWithClient(<App />);
    await screen.findByRole("alert");
    expect(
      screen.queryByRole("navigation", { name: "Admin navigation" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "+ New product" })).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.map(([input]) => new URL(String(input)).pathname),
    ).toEqual(["/admin/product-drafts"]);
  },
);

it.each([200, 403, 503])(
  "waits for fresh server authorization even when drafts are cached (%s)",
  async (status) => {
    const client = testClient();
    const {
      state: _state,
      context: _context,
      attachments: _attachments,
      ...summary
    } = current();
    const payload = { drafts: [summary] };
    client.setQueryData(
      ["admin-drafts", "https://api.benhalverson.dev", "admin"],
      payload,
    );
    let resolve: ((response: Response) => void) | undefined;
    override = (url) =>
      url.pathname === "/admin/product-drafts"
        ? new Promise<Response>((done) => {
            resolve = done;
          })
        : undefined;
    renderWithClient(<App />, client);
    await waitFor(() => expect(resolve).toBeDefined());
    expect(
      screen.queryByRole("navigation", { name: "Admin navigation" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "+ New product" })).toBeNull();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.map(([input]) => new URL(String(input)).pathname),
    ).toEqual(["/admin/product-drafts"]);
    override = undefined;
    await act(() => resolve?.(Response.json(payload, { status })));
    if (status === 200) {
      await ready();
      expect(
        vi
          .mocked(fetch)
          .mock.calls.filter(
            ([input]) =>
              new URL(String(input)).pathname === "/admin/product-drafts",
          ),
      ).toHaveLength(1);
      expect(
        screen.getByRole("navigation", { name: "Admin navigation" }),
      ).toBeVisible();
    } else {
      await screen.findByRole("alert");
      expect(
        screen.queryByRole("navigation", { name: "Admin navigation" }),
      ).toBeNull();
    }
  },
);

it.each(
  [401, 403].flatMap((status) => [
    { status, operation: "refresh" },
    { status, operation: "save" },
  ]),
)(
  "revokes the whole workspace after $operation returns $status",
  async ({ status, operation }) => {
    const client = testClient();
    renderWithClient(<App />, client);
    await ready();
    click("Edit draft facts");
    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: "Private unsaved product" },
    });
    vi.mocked(fetch).mockClear();
    override = (url) =>
      url.pathname === `/admin/product-drafts/${draftId}`
        ? Response.json({ error: "Denied" }, { status })
        : undefined;
    if (operation === "save") click("Save draft answers");
    else
      await act(() =>
        client.invalidateQueries({
          queryKey: [
            "admin-drafts",
            "https://api.benhalverson.dev",
            "admin",
            draftId,
          ],
          exact: true,
        }),
      );
    await screen.findByText(
      status === 401
        ? "Your session has expired. Sign in again to continue."
        : "Private conversations unavailable. Administrator access is required.",
    );
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("button", { name: "+ New product" })).toBeNull();
    expect(screen.queryByLabelText("Product name")).toBeNull();
    expect(screen.queryByLabelText("Product notes")).toBeNull();
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it.each([401, 403])(
  "hides the workspace on initial detail denial (%s)",
  async (status) => {
    override = (url) =>
      url.pathname === `/admin/product-drafts/${draftId}`
        ? Response.json({ error: "Denied" }, { status })
        : undefined;
    renderWithClient(<App />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByLabelText("Product notes")).toBeNull();
  },
);

it.each(["detail", "cleanup"])(
  "stops recovery when its %s read denies access",
  async (stage) => {
    const client = testClient();
    renderWithClient(<App />, client);
    await ready();
    click("Edit draft facts");
    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: "Private" },
    });
    vi.mocked(fetch).mockClear();
    override = (url, init) => {
      if (init?.method === "PUT") return Response.json({}, { status: 500 });
      if (url.pathname === `/admin/product-drafts/${draftId}`)
        return Response.json({}, { status: stage === "detail" ? 403 : 404 });
      if (url.pathname.endsWith("/cleanup"))
        return Response.json({}, { status: 401 });
    };
    click("Save draft answers");
    await screen.findByRole("alert");
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(stage === "detail" ? 2 : 3);
  },
);

it.each([200, 503])(
  "cancels older verification on detail denial and ignores its later %s response",
  async (staleStatus) => {
    const client = testClient();
    renderWithClient(<App />, client);
    await ready();
    const accessKey = [
      "admin-draft-access",
      "https://api.benhalverson.dev",
      "admin",
    ];
    let finish: ((response: Response) => void) | undefined;
    let signal: AbortSignal | null | undefined;
    override = (url, init) => {
      if (url.pathname === "/admin/product-drafts") {
        signal = init?.signal;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      if (url.pathname === `/admin/product-drafts/${draftId}`)
        return Response.json({}, { status: 403 });
    };
    let verifying: Promise<void> | undefined;
    act(() => {
      verifying = client.invalidateQueries({ queryKey: accessKey });
    });
    await waitFor(() => expect(finish).toBeDefined());
    await act(() =>
      client.invalidateQueries({
        queryKey: [
          "admin-drafts",
          "https://api.benhalverson.dev",
          "admin",
          draftId,
        ],
      }),
    );
    await screen.findByText(/Administrator access is required/);
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      required(finish)(Response.json({ drafts: [] }, { status: staleStatus }));
      await verifying;
    });
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Administrator access is required",
    );
    override = (url) =>
      url.pathname === "/admin/product-drafts"
        ? Response.json({}, { status: 503 })
        : undefined;
    click("Retry conversations");
    await screen.findByText("Private conversations unavailable. Please retry.");
    expect(screen.queryByRole("navigation")).toBeNull();
    override = (url) =>
      url.pathname === "/admin/product-drafts"
        ? Response.json({ drafts: "invalid" })
        : undefined;
    click("Retry conversations");
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.queryByRole("navigation")).toBeNull();
    override = undefined;
    click("Retry conversations");
    await ready();
  },
);

it.each(["re-entry", "account", "sign-out"])(
  "ignores an obsolete workspace denial after %s in Strict Mode",
  async (transition) => {
    const client = testClient();
    let view = renderWithClient(
      <StrictMode>
        <App />
      </StrictMode>,
      client,
    );
    await ready();
    let finish: ((response: Response) => void) | undefined;
    override = (_url, init) =>
      init?.method === "PUT"
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : undefined;
    click("Edit draft facts");
    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: "Earlier visit" },
    });
    click("Save draft answers");
    await waitFor(() => expect(finish).toBeDefined());
    override = undefined;
    if (transition === "re-entry") {
      view.unmount();
      view = renderWithClient(
        <StrictMode>
          <App />
        </StrictMode>,
        client,
      );
    } else {
      session.data =
        transition === "account" ? { user: { id: "second-admin" } } : null;
      view.rerender(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    }
    if (transition === "sign-out")
      await screen.findByRole("heading", { name: "Sign in required" });
    else await ready();
    vi.mocked(fetch).mockClear();
    await act(() => required(finish)(Response.json({}, { status: 403 })));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    if (transition !== "sign-out")
      expect(screen.getByRole("navigation")).toBeVisible();
  },
);

it.each(
  [401, 403].flatMap((status) => [
    { status, source: "list" },
    { status, source: "detail" },
  ]),
)(
  "keeps access denied after a delayed save completes following $status $source revocation",
  async ({ status, source }) => {
    const client = testClient();
    renderWithClient(<App />, client);
    await ready();
    let resolveSave: ((response: Response) => void) | undefined;
    override = (_url, init) =>
      init?.method === "PUT"
        ? new Promise<Response>((resolve) => {
            resolveSave = resolve;
          })
        : undefined;
    click("Edit draft facts");
    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: "Private delayed save" },
    });
    click("Save draft answers");
    await waitFor(() => expect(resolveSave).toBeDefined());
    override = (url) =>
      url.pathname ===
      `/admin/product-drafts${source === "detail" ? `/${draftId}` : ""}`
        ? Response.json({ error: "Denied" }, { status })
        : undefined;
    await act(() =>
      client.invalidateQueries({
        queryKey: [
          source === "detail" ? "admin-drafts" : "admin-draft-access",
          "https://api.benhalverson.dev",
          "admin",
          ...(source === "detail" ? [draftId] : []),
        ],
        exact: true,
      }),
    );
    await screen.findByRole("alert");
    expect(
      screen.queryByRole("navigation", { name: "Admin navigation" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "+ New product" })).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
    const saved = draft({
      revision: 2,
      state: {
        answers: { name: "Private delayed save" },
        history: [],
        pendingQuestions: [],
      },
    });
    drafts = [saved];
    await act(() => required(resolveSave)(Response.json(saved)));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(
      screen.queryByRole("navigation", { name: "Admin navigation" }),
    ).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("button", { name: "+ New product" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Edit draft facts" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Product notes")).toBeNull();
    expect(screen.queryByText("Private delayed save")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      status === 401
        ? "Your session has expired"
        : "Administrator access is required",
    );
    override = (url) =>
      url.pathname === "/admin/product-drafts"
        ? Response.json({}, { status: 503 })
        : undefined;
    await act(() =>
      client.invalidateQueries({
        queryKey: [
          "admin-draft-access",
          "https://api.benhalverson.dev",
          "admin",
        ],
        exact: true,
      }),
    );
    await screen.findByText("Private conversations unavailable. Please retry.");
    expect(
      screen.queryByRole("navigation", { name: "Admin navigation" }),
    ).toBeNull();
    override = undefined;
    click("Retry conversations");
    await ready();
  },
);

it("requires fresh authorization on route re-entry despite an earlier pending save", async () => {
  const client = testClient();
  const view = renderWithClient(<App />, client);
  await ready();
  const payload = client.getQueryData([
    "admin-drafts",
    "https://api.benhalverson.dev",
    "admin",
  ]);
  let resolveSave: ((response: Response) => void) | undefined;
  let resolveAccess: ((response: Response) => void) | undefined;
  override = (_url, init) =>
    init?.method === "PUT"
      ? new Promise<Response>((resolve) => {
          resolveSave = resolve;
        })
      : undefined;
  click("Edit draft facts");
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Earlier save" },
  });
  click("Save draft answers");
  await waitFor(() => expect(resolveSave).toBeDefined());
  view.unmount();
  vi.mocked(fetch).mockClear();
  override = (url) =>
    url.pathname === "/admin/product-drafts"
      ? new Promise<Response>((resolve) => {
          resolveAccess = resolve;
        })
      : undefined;
  renderWithClient(<App />, client);
  await waitFor(() => expect(resolveAccess).toBeDefined());
  await act(() => required(resolveSave)(Response.json(current())));
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(screen.getByText("Checking administrator access…")).toBeVisible();
  expect(screen.queryByRole("button", { name: "+ New product" })).toBeNull();
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.map(([input]) => new URL(String(input)).pathname),
  ).toEqual(["/admin/product-drafts"]);
  override = undefined;
  await act(() => required(resolveAccess)(Response.json(payload)));
  await ready();
});

it("retains authorized edits through a temporary list failure and retries", async () => {
  const client = testClient();
  renderWithClient(<App />, client);
  await ready();
  click("Edit draft facts");
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Unsaved product name" },
  });
  override = (url) =>
    url.pathname === "/admin/product-drafts"
      ? Response.json({}, { status: 503 })
      : undefined;
  await act(() =>
    client.invalidateQueries({
      queryKey: ["admin-draft-access", "https://api.benhalverson.dev", "admin"],
      exact: true,
    }),
  );
  await screen.findByText("Private conversations unavailable. Please retry.");
  expect(screen.getByLabelText("Product name")).toHaveValue(
    "Unsaved product name",
  );
  override = undefined;
  click("Retry conversations");
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByLabelText("Product name")).toHaveValue(
    "Unsaved product name",
  );
});

it("ignores an aborted verification response after Strict Mode verifies access again", async () => {
  const client = testClient();
  let resolveAborted: ((response: Response) => void) | undefined;
  let signal: AbortSignal | null | undefined;
  override = (url, init) => {
    if (url.pathname === "/admin/product-drafts" && !resolveAborted) {
      signal = init?.signal;
      return new Promise<Response>((resolve) => {
        resolveAborted = resolve;
      });
    }
  };
  renderWithClient(
    <StrictMode>
      <App />
    </StrictMode>,
    client,
  );
  await ready();
  expect(signal?.aborted).toBe(true);
  const listKey = ["admin-drafts", "https://api.benhalverson.dev", "admin"];
  const verifiedDrafts = client.getQueryData(listKey);
  expect(verifiedDrafts).toMatchObject({ drafts: [{ id: draftId }] });
  await act(() => required(resolveAborted)(Response.json({ drafts: [] })));
  expect(client.getQueryData(listKey)).toEqual(verifiedDrafts);
  expect(
    screen.getByRole("button", { name: "Edit draft facts" }),
  ).toBeVisible();
});

it("rechecks access when the account changes and hides the workspace on sign-out", async () => {
  const view = renderWithClient(<App />);
  await ready();
  override = (url) =>
    url.pathname === "/admin/product-drafts"
      ? Response.json({ error: "Forbidden" }, { status: 403 })
      : undefined;
  session.data = { user: { id: "member" } };
  view.rerender(<App />);
  expect(
    screen.queryByRole("navigation", { name: "Admin navigation" }),
  ).toBeNull();
  await screen.findByText(/Administrator access is required/);
  session.data = null;
  view.rerender(<App />);
  expect(screen.getByRole("link", { name: "Sign in" })).toBeVisible();
  expect(screen.queryByRole("complementary")).toBeNull();
});

it("refreshes cached listings and prices on entering Products and through Refresh", async () => {
  const client = testClient();
  const pageKey = ["catalog", "https://api.benhalverson.dev", "page", 1];
  client.setQueryData(pageKey, apiPage([9]));
  renderWithClient(<App />, client);
  await ready();
  expect(client.getQueryData(pageKey)).toEqual(apiPage([9]));
  click("Products");
  await screen.findByRole("button", { name: /Product #1/ });
  expect(screen.queryByRole("button", { name: /Product #9/ })).toBeNull();
  override = (url) =>
    url.pathname === "/products"
      ? Response.json({
          ...apiPage([1]),
          products: [{ ...apiPage([1]).products[0], price: 12.34 }],
        })
      : undefined;
  click("Refresh catalog");
  await screen.findByText("Online $12.34");
  expect(screen.queryByRole("button", { name: /Product #2/ })).toBeNull();
  click("Products");
  expect(screen.getByText("Online $12.34")).toBeVisible();
  click("Conversations");
  override = undefined;
  click("Products");
  await screen.findByRole("button", { name: /Product #2/ });
  expect(screen.queryByText("Online $12.34")).toBeNull();
});

it("falls back for failed catalog images and recovers when the source changes", async () => {
  const client = testClient();
  renderWithClient(<App />, client);
  await ready();
  await act(async () => click("Products"));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const listing = await screen.findByRole("button", { name: /Product #1/ });
  const image = required(listing.querySelector("img") ?? undefined);
  fireEvent.error(image);
  expect(within(listing).getByText("Image unavailable")).toBeVisible();
  expect(listing.querySelector("img")).toBeNull();
  act(() =>
    client.setQueryData(
      ["catalog", "https://api.benhalverson.dev", "page", 1],
      {
        ...apiPage([1, 2]),
        products: apiPage([1, 2]).products.map((product) => ({
          ...product,
          image: "https://photos.example.com/repaired.png",
        })),
      },
    ),
  );
  await waitFor(() =>
    expect(listing.querySelector("img")).toHaveAttribute(
      "src",
      "https://photos.example.com/repaired.png",
    ),
  );
  expect(within(listing).queryByText("Image unavailable")).toBeNull();
});

it("renders identical saved notes as separate history entries without duplicate-key warnings", async () => {
  const consoleError = vi.spyOn(console, "error");
  renderWithClient(<App />);
  await ready();
  for (let count = 0; count < 2; count++) {
    fireEvent.change(screen.getByLabelText("Product notes"), {
      target: { value: "Repeat this note" },
    });
    click("Save conversation note");
    await settled();
  }
  const history = screen.getByRole("list", { name: "Conversation history" });
  expect(within(history).getAllByRole("listitem")).toHaveLength(2);
  expect(within(history).getAllByText("Repeat this note")).toHaveLength(2);
  expect(consoleError).not.toHaveBeenCalled();
});

it("rebases only dirty answers after conflict without overwriting unrelated concurrent changes", async () => {
  current().state.answers = {
    name: "Original name",
    description: "Original description",
    notes: "Keep these notes",
  };
  let conflicted = false;
  override = (_url, init) => {
    if (init?.method === "PUT" && !conflicted) {
      conflicted = true;
      current().revision = 2;
      current().state.answers.description = "Changed in another tab";
      return Response.json({ error: "Revision conflict" }, { status: 409 });
    }
  };
  renderWithClient(<App />);
  await ready();
  click("Edit draft facts");
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "My local name" },
  });
  click("Save draft answers");
  await screen.findByText(/Saved state has been reloaded/);
  expect(screen.getByLabelText("Product name")).toHaveValue("My local name");
  expect(screen.getByLabelText("Description")).toHaveValue(
    "Changed in another tab",
  );
  click("Save draft answers");
  await screen.findByText("Draft answers saved. No catalog changes were made.");
  expect(
    requests.find((request) => request.method === "PUT")?.body,
  ).toMatchObject({
    expectedRevision: 2,
    state: {
      answers: {
        name: "My local name",
        description: "Changed in another tab",
        notes: "Keep these notes",
      },
    },
  });
  expect(current().state.answers).toEqual({
    name: "My local name",
    description: "Changed in another tab",
    notes: "Keep these notes",
  });
});

it("resolves a resumed incomplete print upload using its retained identity without selecting or uploading bytes", async () => {
  current().attachments.transfers = [
    transfer({
      kind: "print",
      status: "incomplete",
      requiresReselection: true,
      name: "ready.stl",
    }),
  ];
  let confirms = 0;
  override = (url, init) => {
    if (url.pathname.endsWith(`/transfers/${transferId}/confirm`)) {
      confirms++;
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ expectedRevision: 1 });
      current().revision++;
      current().attachments.transfers = [
        transfer({
          kind: "print",
          status: "saved",
          requiresReselection: false,
          name: "ready.stl",
        }),
      ];
      current().attachments.printFile = photo({
        kind: "print",
        name: "ready.stl",
        imageUrl: null,
      });
      return Response.json({ draft: current() });
    }
  };
  renderWithClient(<App />);
  await screen.findByRole("button", { name: "Resolve transfer" });
  expect(screen.getByRole("button", { name: "Reselect file" })).toBeEnabled();
  click("Resolve transfer");
  await screen.findByText("Attachment saved.");
  expect(confirms).toBe(1);
  expect(requests.filter((request) => request.method !== "GET")).toHaveLength(
    0,
  );
  expect(
    vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT"),
  ).toHaveLength(0);
  expect(screen.getByText(/Saved draft.*ready.stl/)).toBeVisible();
});

it.each(["saved", "incomplete", "concurrent"] as const)(
  "clears a %s attachment selection when its target disappears before the next file",
  async (mode) => {
    if (mode === "incomplete") current().attachments.transfers = [transfer()];
    else {
      current().attachments.photos = [photo()];
      current().attachments.photoOrder = [photoId];
    }
    renderWithClient(<App />);
    if (mode !== "incomplete") {
      await ready();
      click("Edit draft facts");
    }
    await screen.findByRole("region", { name: "Product Card" });
    click(mode === "incomplete" ? "Reselect file" : "Replace");
    expect(
      screen.getByLabelText("Replacement / reselected photo"),
    ).toHaveFocus();
    if (mode === "concurrent")
      override = (_url, init) => {
        if (init?.method === "DELETE") {
          current().revision++;
          current().attachments.photos = [];
          current().attachments.photoOrder = [];
          return Response.json({ error: "Revision conflict" }, { status: 409 });
        }
      };
    click("Delete");
    await settled();
    expect(screen.getByLabelText("Product photos (up to 5)")).toBeEnabled();
    let requested: Record<string, unknown> | undefined;
    override = (url, init) => {
      if (url.pathname.endsWith("/intents")) {
        requested = JSON.parse(String(init?.body));
        current().revision++;
        current().attachments.transfers = [
          transfer({ name: "fresh.png", status: "pending" }),
        ];
        return Response.json({
          draft: current(),
          transfer: {
            id: transferId,
            upload: { method: "PUT", url: "/accept-fresh", headers: {} },
          },
        });
      }
      if (url.pathname === "/accept-fresh") {
        current().revision++;
        current().attachments.photos = [photo({ name: "fresh.png" })];
        current().attachments.photoOrder = [photoId];
        current().attachments.transfers = [
          transfer({ name: "fresh.png", status: "saved" }),
        ];
        return Response.json({ draft: current() });
      }
    };
    fireEvent.change(screen.getByLabelText("Product photos (up to 5)"), {
      target: { files: [new File(["1234"], "fresh.png")] },
    });
    await screen.findByText("Attachments saved.");
    expect(requested).toMatchObject({ name: "fresh.png", kind: "photo" });
    expect(requested).not.toHaveProperty("replacesId");
  },
);

it.each(
  [401, 403].flatMap((status) =>
    ["intent", "photo", "retry", "confirm", "recovery", "operation"].map(
      (stage) => ({ status, stage }),
    ),
  ),
)(
  "revokes access on attachment $stage denial ($status) and stops queued files and recovery",
  async ({ status, stage }) => {
    if (stage === "retry") current().attachments.transfers = [transfer()];
    if (stage === "operation") {
      current().attachments.photos = [photo()];
      current().attachments.photoOrder = [photoId];
    }
    const client = testClient();
    renderWithClient(<App />, client);
    if (stage === "retry") {
      await screen.findByLabelText("Product name");
      click("Reselect file");
    } else {
      await ready();
      click("Edit draft facts");
    }
    const paths: string[] = [];
    const denied = () => Response.json({ error: "Denied" }, { status });
    override = (url, init) => {
      paths.push(url.pathname);
      if (
        url.pathname.endsWith("/intents") ||
        url.pathname.endsWith("/retry")
      ) {
        if (stage === "intent" || stage === "retry") return denied();
        return Response.json({
          draft: current(),
          transfer: {
            id: transferId,
            upload: {
              method: "PUT",
              url:
                stage === "confirm"
                  ? "https://uploads.example.test/bytes"
                  : "/photo-bytes",
              headers: {},
            },
          },
        });
      }
      if (url.pathname === "/photo-bytes")
        return stage === "recovery"
          ? Response.json({}, { status: 500 })
          : denied();
      if (url.hostname === "uploads.example.test") return new Response(null);
      if (
        url.pathname.endsWith("/confirm") ||
        init?.method === "DELETE" ||
        stage === "recovery"
      )
        return denied();
    };
    if (stage === "operation") click("Delete");
    else
      fireEvent.change(
        screen.getByLabelText(
          stage === "retry"
            ? "Replacement / reselected photo"
            : stage === "confirm"
              ? "Print file"
              : "Product photos (up to 5)",
        ),
        {
          target: {
            files:
              stage === "retry"
                ? [new File(["1234"], "resume.png")]
                : stage === "confirm"
                  ? [new File(["1234"], "part.stl")]
                  : [
                      new File(["1234"], "first.png"),
                      new File(["1234"], "second.png"),
                    ],
          },
        },
      );
    await screen.findByText(
      status === 401
        ? /Your session has expired/
        : /Administrator access is required/,
    );
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(paths).toHaveLength(
      stage === "confirm" || stage === "recovery"
        ? 3
        : stage === "photo"
          ? 2
          : 1,
    );
  },
);

it.each(["upload", "recovery", "denial"])(
  "stops queued files after denial while a prior %s finishes",
  async (stage) => {
    const client = testClient();
    renderWithClient(<App />, client);
    await ready();
    let finish: ((response: Response) => void) | undefined;
    const delayed = () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      });
    override = (url) => {
      if (url.pathname.endsWith("/intents"))
        return Response.json({
          draft: current(),
          transfer: {
            id: transferId,
            upload: { method: "PUT", url: "/photo-bytes", headers: {} },
          },
        });
      if (url.pathname === "/photo-bytes")
        return stage !== "recovery"
          ? delayed()
          : Response.json({}, { status: 500 });
      if (url.pathname === `/admin/product-drafts/${draftId}`)
        return !finish ? delayed() : Response.json({}, { status: 403 });
    };
    fireEvent.change(screen.getByLabelText("Product photos (up to 5)"), {
      target: {
        files: [
          new File(["1234"], "first.png"),
          new File(["1234"], "second.png"),
        ],
      },
    });
    await waitFor(() => expect(finish).toBeDefined());
    await act(() =>
      client.invalidateQueries({
        queryKey: [
          "admin-drafts",
          "https://api.benhalverson.dev",
          "admin",
          draftId,
        ],
      }),
    );
    await screen.findByText(/Administrator access is required/);
    override = undefined;
    click("Retry conversations");
    await ready();
    vi.mocked(fetch).mockClear();
    const saved = draft();
    saved.attachments.transfers = [transfer({ status: "saved" })];
    await act(() =>
      required(finish)(
        stage === "denial"
          ? Response.json({}, { status: 403 })
          : Response.json(stage === "upload" ? { draft: saved } : saved),
      ),
    );
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("navigation")).toBeVisible();
  },
);

it("does not start verification when an obsolete discard finishes after denial", async () => {
  const client = testClient();
  renderWithClient(<App />, client);
  await ready();
  let finish: ((response: Response) => void) | undefined;
  override = (url, init) => {
    if (init?.method === "DELETE")
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    if (url.pathname === `/admin/product-drafts/${draftId}`)
      return Response.json({}, { status: 403 });
  };
  click("Discard draft");
  await waitFor(() => expect(finish).toBeDefined());
  await act(() =>
    client.invalidateQueries({
      queryKey: [
        "admin-drafts",
        "https://api.benhalverson.dev",
        "admin",
        draftId,
      ],
    }),
  );
  await screen.findByText(/Administrator access is required/);
  vi.mocked(fetch).mockClear();
  await act(() =>
    required(finish)(
      Response.json({
        id: draftId,
        revision: 2,
        status: "discarded",
        cleanup: [],
      }),
    ),
  );
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole("navigation")).toBeNull();
});

it("ignores a denied detail response aborted by Strict Mode cleanup", async () => {
  let finish: ((response: Response) => void) | undefined;
  let signal: AbortSignal | null | undefined;
  override = (url, init) => {
    if (url.pathname === `/admin/product-drafts/${draftId}` && !finish) {
      signal = init?.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
  };
  renderWithClient(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await ready();
  expect(signal?.aborted).toBe(true);
  await act(() => required(finish)(Response.json({}, { status: 403 })));
  expect(screen.getByRole("navigation")).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
});

it.each([401, 403])(
  "treats external print upload %s as a transfer failure and retains the editor",
  async (status) => {
    renderWithClient(<App />);
    await ready();
    click("Edit draft facts");
    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: "Keep my changes" },
    });
    const paths: string[] = [];
    override = (url) => {
      paths.push(url.pathname);
      if (url.pathname.endsWith("/intents"))
        return Response.json({
          draft: current(),
          transfer: {
            id: transferId,
            upload: {
              method: "PUT",
              url: "https://uploads.example.test/bytes",
              headers: {},
            },
          },
        });
      if (url.hostname === "uploads.example.test")
        return Response.json({}, { status });
    };
    fireEvent.change(screen.getByLabelText("Print file"), {
      target: { files: [new File(["1234"], "part.stl")] },
    });
    await screen.findByText(new RegExp(`Transfer failed \\(${status}\\)`));
    await settled();
    expect(screen.getByRole("navigation")).toBeVisible();
    expect(screen.getByLabelText("Product name")).toHaveValue(
      "Keep my changes",
    );
    expect(paths).toEqual([
      `/admin/product-drafts/${draftId}/attachments/intents`,
      "/bytes",
      `/admin/product-drafts/${draftId}`,
    ]);
  },
);

it.each(["rejected", "reload-failed", "ambiguous"] as const)(
  "retains later photo bytes when the first upload is %s",
  async (mode) => {
    const intents: string[] = [];
    let failRead = false;
    let latestName = "";
    override = (url, init) => {
      if (url.pathname.endsWith("/intents")) {
        const body = JSON.parse(String(init?.body));
        expect(body.expectedRevision).toBe(current().revision);
        latestName = body.name;
        intents.push(latestName);
        current().revision++;
        current().attachments.transfers = [
          transfer({ name: latestName, status: "pending" }),
        ];
        return Response.json({
          draft: current(),
          transfer: {
            id: transferId,
            upload: { method: "PUT", url: "/photo-bytes", headers: {} },
          },
        });
      }
      if (url.pathname === "/photo-bytes") {
        if (latestName === "corrupt.png") {
          current().revision++;
          current().attachments.transfers = [
            transfer({
              name: latestName,
              status: "failed",
              error: "Photo could not be decoded",
            }),
          ];
          failRead = mode === "reload-failed";
          if (mode === "ambiguous") return Promise.reject("Connection lost");
          return Response.json(
            { error: "Photo could not be decoded" },
            { status: 400 },
          );
        }
        expect(init?.body).toBeInstanceOf(File);
        if (!(init?.body instanceof File))
          throw Error("Expected retained file bytes");
        expect(init.body.name).toBe("good.png");
        current().revision++;
        current().attachments.photos = [photo({ name: "good.png" })];
        current().attachments.photoOrder = [photoId];
        current().attachments.transfers = [
          transfer({ name: "good.png", status: "saved" }),
        ];
        return Response.json({ draft: current() });
      }
      if (failRead && url.pathname === `/admin/product-drafts/${draftId}`)
        return Response.json({ error: "Reload unavailable" }, { status: 503 });
    };
    renderWithClient(<App />);
    await ready();
    click("Edit draft facts");
    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: "Retain my answer" },
    });
    fireEvent.change(screen.getByLabelText("Product photos (up to 5)"), {
      target: {
        files: [
          new File(["bad!"], "corrupt.png"),
          new File(["1234"], "good.png"),
        ],
      },
    });
    if (mode !== "rejected") {
      const queue = await screen.findByRole("region", {
        name: "Queued attachments",
      });
      expect(within(queue).getByText("good.png")).toBeVisible();
      if (mode === "reload-failed") {
        await screen.findByText(/saved outcome is unresolved/);
        expect(
          screen.getByRole("button", { name: "Continue queued files" }),
        ).toBeDisabled();
        failRead = false;
        click("Reload saved state");
        await screen.findByText(
          "Saved state reloaded. Review before continuing.",
        );
      } else await screen.findByText("corrupt.png: Transfer failed.");
      expect(intents).toEqual(["corrupt.png"]);
      click("Continue queued files");
    }
    await screen.findByText(
      mode === "ambiguous"
        ? "Attachments saved. corrupt.png: Transfer failed."
        : "Attachments saved. corrupt.png: Photo could not be decoded",
    );
    expect(intents).toEqual(["corrupt.png", "good.png"]);
    expect(screen.getByAltText("good.png")).toBeVisible();
    expect(screen.getByLabelText("Product name")).toHaveValue(
      "Retain my answer",
    );
    expect(
      screen.queryByRole("region", { name: "Queued attachments" }),
    ).toBeNull();
  },
);

it("offers explicit file reselection for an unresolved print while retaining its prior unknown generation", async () => {
  current().attachments.transfers = [
    transfer({
      kind: "print",
      name: "part.stl",
      status: "unresolved",
      requiresReselection: false,
    }),
  ];
  let retries = 0;
  override = (url, init) => {
    if (url.pathname.endsWith(`/transfers/${transferId}/retry`)) {
      retries++;
      expect(init?.method).toBe("POST");
      current().revision++;
      current().attachments.transfers = [
        transfer({
          kind: "print",
          name: "part.stl",
          attachmentId: otherId,
          status: "pending",
        }),
      ];
      current().attachments.cleanup = [
        {
          id: photoId,
          assetId: photoId,
          status: "protected",
          reason: "Prior upload outcome unknown",
        },
      ];
      return Response.json({
        draft: current(),
        transfer: {
          id: transferId,
          upload: {
            method: "PUT",
            url: "https://upload.example.com/reselected",
            headers: {},
          },
        },
      });
    }
    if (url.hostname === "upload.example.com") return new Response(null);
    if (url.pathname.endsWith("/confirm")) {
      current().revision++;
      current().attachments.transfers = [
        transfer({
          kind: "print",
          name: "part.stl",
          attachmentId: otherId,
          status: "saved",
        }),
      ];
      current().attachments.printFile = photo({
        id: otherId,
        assetId: otherId,
        kind: "print",
        name: "part.stl",
        imageUrl: null,
      });
      return Response.json({ draft: current() });
    }
  };
  renderWithClient(<App />);
  await screen.findByRole("button", { name: "Resolve transfer" });
  click("Reselect file");
  expect(retries).toBe(0);
  fireEvent.change(
    screen.getByLabelText("Replacement / reselected print file"),
    { target: { files: [new File(["1234"], "part.stl")] } },
  );
  await screen.findByText("Attachments saved.");
  expect(retries).toBe(1);
  expect(current().attachments.printFile?.assetId).toBe(otherId);
  expect(
    screen.getByText("Referenced file retained: Prior upload outcome unknown"),
  ).toBeVisible();
});

it("does not claim any attachment saved when the entire selection is rejected", async () => {
  override = (url) =>
    url.pathname.endsWith("/intents")
      ? Response.json({ error: "Photo limit reached" }, { status: 400 })
      : undefined;
  renderWithClient(<App />);
  await ready();
  fireEvent.change(screen.getByLabelText("Product photos (up to 5)"), {
    target: { files: [new File(["1234"], "extra.png")] },
  });
  await screen.findByText(
    "No additional attachments saved. extra.png: Photo limit reached",
  );
  expect(current().attachments.photos).toHaveLength(0);
  expect(
    screen.queryByRole("region", { name: "Queued attachments" }),
  ).toBeNull();
});

it("uses existing sign-in and waits for the session", () => {
  session.isPending = true;
  const view = renderWithClient(<App />);
  expect(screen.getByText("Checking your session…")).toBeVisible();
  expect(fetch).not.toHaveBeenCalled();
  session.isPending = false;
  session.data = null;
  view.rerender(<App />);
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/signin?returnTo=%2Fadmin%2Fproducts",
  );
  session.error = new Error("session unavailable");
  view.rerender(<App />);
  expect(
    screen.getByText("Sign in to open your private product conversations."),
  ).toBeVisible();
  expect(
    screen.queryByRole("navigation", { name: "Admin navigation" }),
  ).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it("browses authoritative products, saves independent facts through the real card and resumes", async () => {
  renderWithClient(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await ready();
  click("Edit draft facts");
  fireEvent.change(await screen.findByLabelText("Product name"), {
    target: { value: "Pit tray" },
  });
  expect(screen.getAllByRole("region", { name: "Product Card" })).toHaveLength(
    1,
  );
  click("Products");
  await screen.findByRole("button", { name: /Product #1/ });
  fireEvent.change(screen.getByLabelText("Search products"), {
    target: { value: "Part 2" },
  });
  expect(
    screen.queryByRole("button", { name: /Product #1/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: /Product #2/ }));
  await screen.findByLabelText("Product name");
  await settled();
  expect(current().state.answers.name).toBe("Pit tray");
  expect(screen.getByLabelText("Product name")).toHaveValue("");
  expect(required(drafts[1]).target).toEqual({
    kind: "existing",
    productId: 2,
  });
  fireEvent.click(
    within(screen.getByRole("complementary")).getByRole("button", {
      name: /New product/,
    }),
  );
  await screen.findByRole("heading", { name: "Pit tray" });
  click("Edit draft facts");
  fireEvent.change(screen.getByLabelText("Notes"), {
    target: { value: "Keep my jig" },
  });
  click("Save draft answers");
  await screen.findByText("Draft answers saved. No catalog changes were made.");
  fireEvent.change(screen.getByLabelText("Product notes"), {
    target: { value: "Needs a wider slot" },
  });
  click("Save conversation note");
  await screen.findByText("Needs a wider slot");
  expect(current().state.answers.notes).toBe("Keep my jig");
  expect(
    requests
      .filter((r) => r.method === "PUT")
      .map((r) => r.body.expectedRevision),
  ).toEqual([1, 2, 3]);
});
it("restores the last selected draft, handles unavailable context, and reuses an existing product conversation", async () => {
  drafts = [
    draft(),
    draft({
      id: otherId,
      target: { kind: "existing", productId: 2 },
      context: { status: "unavailable", productId: 2 },
    }),
  ];
  localStorage.setItem(
    "lulu-admin-draft:https://api.benhalverson.dev:admin",
    JSON.stringify(otherId),
  );
  renderWithClient(<App />);
  await screen.findByText(/Product #2 is unavailable/);
  click("Products");
  fireEvent.click(
    await within(screen.getByRole("region", { name: "Products" })).findByRole(
      "button",
      { name: /Product #2/ },
    ),
  );
  await screen.findByText(/Product #2 is unavailable/);
  expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
});
it("reorders photos independently of primary, replaces through the composer, and deletes directly", async () => {
  drafts = [
    draft({
      attachments: {
        ...draft().attachments,
        photos: [photo(), photo({ id: otherPhotoId, name: "side.webp" })],
        photoOrder: [photoId, otherPhotoId],
        primaryPhotoId: photoId,
      },
      state: {
        answers: { name: "Retained" },
        pendingQuestions: [{ id: "material", prompt: "Which material?" }],
        history: [{ role: "assistant", content: "Saved context" }],
      },
    }),
  ];
  renderWithClient(<App />);
  const card = await screen.findByRole("region", { name: "Product Card" });
  expect(within(card).getByText("Which material?")).toBeVisible();
  const photos = within(card).getAllByRole("listitem");
  fireEvent.click(
    within(required(photos[1])).getByRole("button", { name: "Move earlier" }),
  );
  await settled();
  expect(current().attachments.photoOrder).toEqual([otherPhotoId, photoId]);
  expect(current().attachments.primaryPhotoId).toBe(photoId);
  fireEvent.click(
    within(
      required(
        screen
          .getAllByRole("listitem")
          .find((item) => item.textContent?.includes("part.png")),
      ),
    ).getByRole("button", { name: "Move earlier" }),
  );
  await settled();
  fireEvent.click(
    required(
      within(
        screen.getByRole("list", { name: "Draft attachments" }),
      ).getAllByRole("button", { name: "Move later" })[0],
    ),
  );
  await settled();
  fireEvent.click(
    required(
      within(
        screen.getByRole("list", { name: "Draft attachments" }),
      ).getAllByRole("button", { name: "Make primary" })[0],
    ),
  );
  await settled();
  expect(current().attachments.primaryPhotoId).toBe(otherPhotoId);
  fireEvent.click(
    required(
      within(
        screen.getByRole("list", { name: "Draft attachments" }),
      ).getAllByRole("button", { name: "Replace" })[0],
    ),
  );
  expect(screen.getByLabelText("Replacement / reselected photo")).toHaveFocus();
  fireEvent.click(
    required(
      within(
        screen.getByRole("list", { name: "Draft attachments" }),
      ).getAllByRole("button", { name: "Delete" })[0],
    ),
  );
  await settled();
  expect(current().attachments.photos).toHaveLength(1);
  expect(screen.getByLabelText("Product name")).toHaveValue("Retained");
});
it("reloads conflict outcomes before allowing another save and preserves typed answers", async () => {
  let failed = false;
  override = (_url, init) => {
    if (init?.method === "PUT" && !failed) {
      failed = true;
      current().revision = 2;
      return Response.json({ error: "Revision conflict" }, { status: 409 });
    }
  };
  renderWithClient(<App />);
  await ready();
  click("Edit draft facts");
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Keep this answer" },
  });
  click("Save draft answers");
  await screen.findByText(/Saved state has been reloaded/);
  expect(screen.getByLabelText("Product name")).toHaveValue("Keep this answer");
  click("Save draft answers");
  await screen.findByText(/Draft answers saved/);
  expect(requests.find((r) => r.method === "PUT")?.body.expectedRevision).toBe(
    2,
  );
});
it("discards explicitly and reports pending cleanup and protected assets", async () => {
  current().attachments.cleanup = [
    {
      id: photoId,
      assetId: photoId,
      status: "pending",
      reason: "Provider deletion unavailable",
    },
    {
      id: otherPhotoId,
      assetId: otherPhotoId,
      status: "protected",
      reason: "Order reference",
    },
    { id: transferId, assetId: transferId, status: "deleted", reason: null },
  ];
  renderWithClient(<App />);
  await ready();
  click("Discard draft");
  await screen.findByRole("heading", { name: "Draft discarded" });
  expect(
    screen.getByText("File cleanup pending: Provider deletion unavailable"),
  ).toBeVisible();
  expect(
    screen.getByText("Referenced file retained: Order reference"),
  ).toBeVisible();
  expect(screen.getByText("File deleted")).toBeVisible();
  click("Retry cleanup");
  await screen.findByText("Cleanup state refreshed.");
  fireEvent.click(
    within(screen.getByRole("complementary")).getByRole("button", {
      name: /Discarded/,
    }),
  );
  await screen.findByRole("heading", { name: "Draft discarded" });
});
it("owns and disposes A2UI processors in StrictMode and resumes incomplete transfers", async () => {
  current().attachments.transfers = [
    transfer(),
    transfer({
      id: otherPhotoId,
      attachmentId: photoId,
      name: "print.stl",
      kind: "print",
      status: "unresolved",
      requiresReselection: false,
      error: "Provider outcome unknown",
    }),
  ];
  const dispose = vi.spyOn(SurfaceGroupModel.prototype, "dispose");
  const view = renderWithClient(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByRole("region", { name: "Product Card" });
  const buttons = screen.getAllByRole("button", { name: "Reselect file" });
  expect(
    screen.getByRole("button", { name: "Resolve transfer" }),
  ).toBeEnabled();
  fireEvent.click(required(buttons[0]));
  expect(screen.getByLabelText("Replacement / reselected photo")).toHaveFocus();
  expect(screen.getByText(/Provider outcome unknown/)).toBeVisible();
  view.unmount();
  expect(dispose).toHaveBeenCalledTimes(2);
});

it("starts a separate new draft, reports unavailable catalog and empty searches", async () => {
  drafts = [];
  renderWithClient(<App />);
  await screen.findByText(
    "Select a product or start a new product conversation.",
  );
  click("+ New product");
  await screen.findByLabelText("Product name");
  await settled();
  expect(drafts).toHaveLength(1);
  click("Products");
  fireEvent.change(screen.getByLabelText("Search products"), {
    target: { value: "absent" },
  });
  await screen.findByText("No products match your search.");
  click("Conversations");
  expect(screen.getByLabelText("Product name")).toHaveValue("");
});
it("shows current product context, print controls and authoritative validation", async () => {
  drafts = [
    draft({
      target: { kind: "existing", productId: 1 },
      context: {
        status: "available",
        product: {
          id: 1,
          name: "Current tray",
          description: "Current description",
          image: null,
          price: 12,
          filamentType: "PLA",
          color: null,
          skuNumber: null,
          publicFileServiceId: null,
        },
        categories: [],
      },
    }),
  ];
  current().attachments.printFile = photo({
    kind: "print",
    imageUrl: null,
    name: "part.stl",
  });
  current().attachments.validation = [
    { field: "color", code: "missing", message: "Choose a color" },
  ];
  renderWithClient(<App />);
  await screen.findByRole("heading", { level: 1, name: "Current tray" });
  expect(screen.getByText("Choose a color")).toBeVisible();
  click("Replace");
  expect(
    screen.getByLabelText("Replacement / reselected print file"),
  ).toHaveFocus();
  click("Delete");
  await settled();
  expect(current().attachments.printFile).toBeNull();
});
it("rejects invalid local files without transfer, uploads valid photos, and keeps draft answers", async () => {
  renderWithClient(<App />);
  await ready();
  click("Edit draft facts");
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Typed answer" },
  });
  fireEvent.change(screen.getByLabelText("Product photos (up to 5)"), {
    target: { files: [new File(["bad"], "bad.gif")] },
  });
  expect(screen.getByText(/select a JPG/)).toBeVisible();
  expect(requests.filter((r) => r.path.includes("intents"))).toHaveLength(0);
  override = (url) => {
    if (url.pathname.endsWith("/intents")) {
      current().revision++;
      current().attachments.transfers = [transfer({ status: "pending" })];
      return Response.json({
        draft: current(),
        transfer: {
          id: transferId,
          upload: { method: "PUT", url: "/upload-photo", headers: {} },
        },
      });
    }
    if (url.pathname === "/upload-photo") {
      current().revision++;
      current().attachments.photos = [photo()];
      current().attachments.photoOrder = [photoId];
      current().attachments.transfers = [
        transfer({ status: "saved", requiresReselection: false }),
      ];
      return Response.json({ draft: current() });
    }
  };
  fireEvent.change(screen.getByLabelText("Product photos (up to 5)"), {
    target: {
      files: [new File(["1234"], "part.png"), new File(["bad"], "bad.gif")],
    },
  });
  await screen.findByText(/Attachments saved.*bad.gif/);
  expect(screen.getByLabelText("Product name")).toHaveValue("Typed answer");
  expect(screen.getByAltText("part.png")).toHaveAttribute(
    "crossorigin",
    "use-credentials",
  );
  fireEvent.error(screen.getByAltText("part.png"));
  expect(screen.getByText("Saved photo preview unavailable.")).toBeVisible();
  click("Save draft answers");
  await screen.findByText("Draft answers saved. No catalog changes were made.");
  expect(screen.queryByRole("region", { name: "Product Card" })).toBeNull();
  expect(screen.getByText(/Saved draft · 1 photos/)).toBeVisible();
  click("Edit draft facts");
  expect(await screen.findByAltText("part.png")).toBeVisible();
});
it("blocks unresolved writes, reloads before retry, and guards leaving while a write is pending", async () => {
  let rejectWrite: ((value: Response) => void) | undefined;
  let failRead = false;
  override = (url, init) => {
    if (init?.method === "PUT")
      return new Promise<Response>((resolve) => {
        rejectWrite = resolve;
      });
    if (failRead && url.pathname.startsWith(`/admin/product-drafts/${draftId}`))
      return Response.json({ error: "Offline" }, { status: 503 });
  };
  renderWithClient(<App />);
  await ready();
  click("Edit draft facts");
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Protected" },
  });
  click("Save draft answers");
  await waitFor(() => expect(rejectWrite).toBeDefined());
  expect(screen.getByRole("button", { name: "+ New product" })).toBeDisabled();
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("link", { name: "Lulu Speedworks home" }));
  expect(location.pathname).toBe("/admin/products");
  failRead = true;
  await act(async () =>
    rejectWrite?.(Response.json({ error: "Unknown outcome" }, { status: 500 })),
  );
  await screen.findByText(/saved outcome is unresolved/);
  expect(
    screen.getByRole("button", { name: "Save draft answers" }),
  ).toBeDisabled();
  failRead = false;
  click("Reload saved state");
  await screen.findByText("Saved state reloaded. Review before continuing.");
  expect(screen.getByLabelText("Product name")).toHaveValue("Protected");
  const idle = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(idle);
  expect(idle.defaultPrevented).toBe(false);
});
it("discovers a lost discard response through its cleanup tombstone", async () => {
  override = (_url, init) => {
    if (init?.method === "DELETE") {
      current().status = "discarded";
      return Response.json(
        { error: "Connection interrupted" },
        { status: 500 },
      );
    }
  };
  renderWithClient(<App />);
  await ready();
  click("Discard draft");
  await screen.findByRole("heading", { name: "Draft discarded" });
  await screen.findByText(/Saved state has been reloaded/);
  expect(screen.getByText("No file cleanup pending.")).toBeVisible();
});
it("recovers denied lists, missing drafts and failed catalog reads through explicit retry", async () => {
  let deny = true;
  let missing = true;
  let catalogFail = true;
  override = (url) => {
    if (url.pathname === "/admin/product-drafts" && deny)
      return Response.json({ error: "Forbidden" }, { status: 403 });
    if (url.pathname === `/admin/product-drafts/${draftId}` && missing)
      return Response.json({ error: "Draft missing" }, { status: 404 });
    if (url.pathname === "/products" && catalogFail)
      return Response.json({}, { status: 503 });
  };
  renderWithClient(<App />);
  await screen.findByText(/Administrator access is required/);
  deny = false;
  click("Retry conversations");
  await screen.findByText("Saved conversation unavailable.");
  missing = false;
  click("Retry draft");
  await ready();
  click("Products");
  await screen.findByText("Catalog unavailable. Please retry.");
  catalogFail = false;
  click("Retry catalog");
  await screen.findAllByRole("button", { name: /Manage product/ });
});
it("renders empty catalog and absent images without inventing listings", async () => {
  override = (url) =>
    url.pathname === "/products" ? Response.json(apiPage([])) : undefined;
  renderWithClient(<App />);
  await ready();
  click("Products");
  await screen.findByText("No catalog products yet.");
});

it("resolves unknown transfers without file reselection and never labels an unresolved reply saved", async () => {
  current().attachments.transfers = [
    transfer({
      requiresReselection: false,
      status: "unresolved",
      error: "Unknown provider outcome",
    }),
  ];
  let confirmed = false;
  override = (url) => {
    if (url.pathname.endsWith("/confirm")) {
      current().revision++;
      current().attachments.transfers = [
        transfer({
          requiresReselection: false,
          status: confirmed ? "saved" : "unresolved",
          error: confirmed ? null : "Still resolving",
        }),
      ];
      return Response.json({ draft: current() });
    }
  };
  renderWithClient(<App />);
  await screen.findByRole("button", { name: "Resolve transfer" });
  click("Resolve transfer");
  await screen.findByText(/Still resolving.*Saved state has been reloaded/);
  expect(screen.queryByText("Attachment saved.")).not.toBeInTheDocument();
  confirmed = true;
  click("Resolve transfer");
  await screen.findByText("Attachment saved.");
  expect(
    screen.queryByRole("button", { name: "Resolve transfer" }),
  ).not.toBeInTheDocument();
});
it("keeps the previous print file through a new upload and supports targeted reselect", async () => {
  current().attachments.printFile = photo({
    kind: "print",
    name: "old.stl",
    imageUrl: null,
  });
  current().attachments.transfers = [
    transfer({ kind: "print", name: "new.stl", replacesId: photoId }),
  ];
  let selected = false;
  override = (url, init) => {
    if (url.pathname.endsWith("/retry")) {
      selected = true;
      expect(JSON.parse(String(init?.body))).toEqual({ expectedRevision: 1 });
      return Response.json({
        draft: current(),
        transfer: {
          id: transferId,
          upload: {
            method: "PUT",
            url: "https://upload.example.com/print",
            headers: {},
          },
        },
      });
    }
    if (url.hostname === "upload.example.com") {
      expect(current().attachments.printFile?.name).toBe("old.stl");
      return new Response(null);
    }
    if (url.pathname.endsWith("/confirm")) {
      current().revision++;
      current().attachments.printFile = photo({
        kind: "print",
        name: "new.stl",
        imageUrl: null,
      });
      current().attachments.transfers = [
        transfer({ kind: "print", name: "new.stl", status: "saved" }),
      ];
      return Response.json({ draft: current() });
    }
  };
  renderWithClient(<App />);
  await screen.findByRole("button", { name: "Reselect file" });
  click("Reselect file");
  fireEvent.change(
    screen.getByLabelText("Replacement / reselected print file"),
    { target: { files: [new File(["1234"], "new.stl")] } },
  );
  await screen.findByText("Attachments saved.");
  expect(selected).toBe(true);
  expect(screen.getByText("new.stl")).toBeVisible();
});
it("rejects forged and stale A2UI actions before any draft request", async () => {
  current().attachments.photos = [photo()];
  current().attachments.photoOrder = [photoId];
  const dispatch = vi.spyOn(SurfaceModel.prototype, "dispatchAction");
  renderWithClient(<App />);
  await ready();
  click("Edit draft facts");
  await screen.findByLabelText("Product name");
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Keep" },
  });
  const surface = dispatch.mock.instances[0];
  if (!(surface instanceof SurfaceModel)) throw Error("Expected surface");
  const send = (name: string, context: Record<string, string> = {}) =>
    act(() => surface.dispatchAction({ event: { name, context } }, "root"));
  await send("answer", {
    draftId: otherId,
    field: "name",
    value: "Wrong product",
  });
  await send("answer", { draftId, field: "unsupported", value: "No" });
  await send("delete", { draftId, id: "invalid" });
  await send("replace", { draftId, id: otherPhotoId });
  await send("delete", { draftId, id: otherPhotoId });
  await send("earlier", { draftId, id: photoId });
  await settled();
  await send("later", { draftId, id: photoId });
  await settled();
  await send("unsupported", { draftId, id: photoId });
  await settled();
  expect(screen.getByLabelText("Product name")).toHaveValue("Keep");
  expect(requests.filter((r) => r.method !== "GET")).toHaveLength(0);
  let resolve: ((value: Response) => void) | undefined;
  override = (_url, init) =>
    init?.method === "PUT"
      ? new Promise<Response>((done) => {
          resolve = done;
        })
      : undefined;
  await send("save", { draftId });
  await waitFor(() => expect(resolve).toBeDefined());
  await send("answer", { draftId, field: "name", value: "During write" });
  expect(screen.getByLabelText("Product name")).toHaveValue("Keep");
  await act(() =>
    resolve?.(
      Response.json(
        draft({
          state: {
            answers: { name: "Keep" },
            history: [],
            pendingQuestions: [],
          },
        }),
      ),
    ),
  );
});
it("recovers a failed new conversation request by reloading the list, including failed recovery", async () => {
  drafts = [];
  let failList = false;
  override = (url, init) => {
    if (init?.method === "POST") return Promise.reject("Lost response");
    if (failList && url.pathname === "/admin/product-drafts")
      return Response.json({ error: "Offline" }, { status: 503 });
  };
  renderWithClient(<App />);
  await screen.findByText(
    "Select a product or start a new product conversation.",
  );
  click("+ New product");
  await screen.findByText(
    /Draft request failed. Saved state has been reloaded/,
  );
  failList = true;
  click("+ New product");
  await screen.findByText(/saved outcome is unresolved/);
  failList = false;
  click("Reload saved state");
  await screen.findByText("Saved state reloaded. Review before continuing.");
});

it("keeps active cleanup distinct from discard when a save and authoritative read fail", async () => {
  let failed = false;
  override = (url, init) => {
    if (init?.method === "PUT") {
      failed = true;
      return Response.json({ error: "Save failed" }, { status: 500 });
    }
    if (failed && url.pathname === `/admin/product-drafts/${draftId}`)
      return Response.json({ error: "Read failed" }, { status: 500 });
  };
  renderWithClient(<App />);
  await ready();
  click("Edit draft facts");
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Pending" },
  });
  click("Save draft answers");
  await screen.findByRole("heading", { name: "Attachment cleanup" });
  await screen.findByText(/saved outcome is unresolved/);
  expect(screen.queryByText("Draft discarded")).toBeNull();
});
it("serializes duplicate gestures and protects upload and form controls during a write", async () => {
  let resolve: ((value: Response) => void) | undefined;
  override = (_url, init) =>
    init?.method === "PUT"
      ? new Promise<Response>((done) => {
          resolve = done;
        })
      : undefined;
  const client = testClient();
  renderWithClient(<App />, client);
  await ready();
  click("Edit draft facts");
  fireEvent.submit(
    screen.getByRole("form", { name: "Product conversation composer" }),
  );
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Only once" },
  });
  act(() => {
    click("Save draft answers");
    click("Save draft answers");
  });
  await waitFor(() => expect(resolve).toBeDefined());
  fireEvent.change(screen.getByLabelText("Product photos (up to 5)"), {
    target: { files: [new File(["1234"], "photo.png")] },
  });
  // Recovering a retained response can repopulate a cache cleared by session teardown.
  client.removeQueries({
    queryKey: ["admin-drafts", "https://api.benhalverson.dev", "admin"],
    exact: true,
  });
  await act(() =>
    resolve?.(
      Response.json(
        draft({
          state: {
            answers: { name: "Only once" },
            history: [],
            pendingQuestions: [],
          },
        }),
      ),
    ),
  );
  await screen.findByText("Draft answers saved. No catalog changes were made.");
});
it("handles cancelled file choosers and replacement mode independently for print and photo", async () => {
  current().attachments.printFile = photo({
    kind: "print",
    name: "original.stl",
    imageUrl: null,
  });
  renderWithClient(<App />);
  await ready();
  expect(screen.getByText(/Saved draft.*original.stl/)).toBeVisible();
  click("Edit draft facts");
  await screen.findByRole("region", { name: "Product Card" });
  fireEvent.change(screen.getByLabelText("Product photos (up to 5)"), {
    target: { files: null },
  });
  fireEvent.change(screen.getByLabelText("Print file"), {
    target: { files: null },
  });
  click("Replace");
  fireEvent.change(screen.getByLabelText("Product photos (up to 5)"), {
    target: { files: null },
  });
  fireEvent.change(
    screen.getByLabelText("Replacement / reselected print file"),
    { target: { files: null } },
  );
  expect(requests.filter((r) => r.method !== "GET")).toHaveLength(0);
});
it("uploads a new print selection and restores pending photo transfers without claiming saved bytes", async () => {
  current().attachments.transfers = [transfer({ status: "pending" })];
  renderWithClient(<App />);
  await screen.findByText(/Incomplete transfer/);
  fireEvent.change(screen.getByLabelText("Print file"), {
    target: { files: null },
  });
  expect(requests.filter((r) => r.method !== "GET")).toHaveLength(0);
});
it("keeps listings with missing previews identifiable and permits leaving while idle", async () => {
  override = (url) =>
    url.pathname === "/products"
      ? Response.json({
          ...apiPage([1]),
          products: [
            {
              id: 1,
              name: "Bare part",
              description: "No preview",
              price: 1,
              image: null,
            },
          ],
        })
      : undefined;
  renderWithClient(<App />);
  await ready();
  click("Products");
  await screen.findByText("Image unavailable");
  expect(
    screen.getByRole("button", { name: /Product #1.*Bare part/ }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("link", { name: "Lulu Speedworks home" }));
  expect(location.pathname).toBe("/");
});

it.each([
  { kind: "photo" as const, reason: "R2 deletion failed", recovered: true },
  {
    kind: "print" as const,
    reason: "Provider deletion unsupported",
    recovered: false,
  },
])(
  "shows and retries active $kind cleanup after removal and resume without losing answers",
  async ({ kind, reason, recovered }) => {
    const attachment = photo({
      kind,
      imageUrl: kind === "photo" ? "/private/part.png" : null,
    });
    if (kind === "photo") {
      current().attachments.photos = [attachment];
      current().attachments.photoOrder = [photoId];
    } else current().attachments.printFile = attachment;
    let cleanupRevision: number | undefined;
    override = (url, init) => {
      if (
        init?.method === "DELETE" &&
        url.pathname.endsWith(`/attachments/${photoId}`)
      ) {
        current().revision++;
        current().attachments.photos = [];
        current().attachments.photoOrder = [];
        current().attachments.printFile = null;
        current().attachments.cleanup = [
          { id: photoId, assetId: photoId, status: "pending", reason },
        ];
        return Response.json({ draft: current() });
      }
      if (url.pathname.endsWith("/cleanup/retry")) {
        cleanupRevision = JSON.parse(String(init?.body)).expectedRevision;
        current().revision++;
        current().attachments.cleanup = [
          {
            id: photoId,
            assetId: photoId,
            status: recovered ? "deleted" : "pending",
            reason: recovered ? null : reason,
          },
        ];
        return Response.json({
          id: draftId,
          revision: current().revision,
          status: "active",
          cleanup: current().attachments.cleanup,
        });
      }
    };
    const first = renderWithClient(<App />);
    await ready();
    click("Edit draft facts");
    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: "Kept through removal" },
    });
    click("Delete");
    await settled();
    expect(screen.getByText(`File cleanup pending: ${reason}`)).toBeVisible();
    expect(
      screen.getByText("Attachment changes saved. File cleanup pending."),
    ).toBeVisible();
    expect(screen.getByLabelText("Product name")).toHaveValue(
      "Kept through removal",
    );
    click("Save draft answers");
    await screen.findByText(
      "Draft answers saved. No catalog changes were made.",
    );
    first.unmount();
    renderWithClient(<App />);
    await ready();
    expect(screen.getByText(`File cleanup pending: ${reason}`)).toBeVisible();
    click("Edit draft facts");
    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: "Kept through cleanup" },
    });
    click("Retry cleanup");
    await screen.findByText("Cleanup state refreshed.");
    expect(cleanupRevision).toBe(3);
    expect(screen.getByLabelText("Product name")).toHaveValue(
      "Kept through cleanup",
    );
    expect(
      screen.getByText(
        recovered ? "File deleted" : `File cleanup pending: ${reason}`,
      ),
    ).toBeVisible();
    click("Save draft answers");
    await screen.findByText(
      "Draft answers saved. No catalog changes were made.",
    );
    expect(
      requests
        .filter((request) => request.method === "PUT")
        .map((request) => request.body.expectedRevision),
    ).toEqual([2, 4]);
    expect(current().state.answers.name).toBe("Kept through cleanup");
  },
);
