import { SurfaceModel } from "@a2ui/web_core/v0_9";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { ProductDraft } from "../src/admin/contracts";
import type { Action, Preparation } from "../src/admin/mutations";
import { draft, draftId, otherId, photo } from "./admin-fixtures";
import {
  mutationResult,
  operationId,
  preparation,
  preparationId,
} from "./admin-mutation-fixtures";
import { apiPage, categories } from "./catalog-fixtures";
import { renderWithClient } from "./query-client";

const session = vi.hoisted(() => ({
  data: { user: { id: "admin" } } as { user: { id: string } } | null,
  isPending: false,
  error: null,
}));
vi.mock("../src/storefront/auth", async (original) => {
  const actual = await original<typeof import("../src/storefront/auth")>();
  return { ...actual, authClient: { useSession: () => session } };
});

type Request = { path: string; method: string; body: Record<string, unknown> };
let saved: ProductDraft;
let prepared: Preparation | null;
let requests: Request[];
let override:
  | ((request: Request) => Response | Promise<Response> | undefined)
  | undefined;
beforeEach(() => {
  session.data = { user: { id: "admin" } };
  localStorage.clear();
  window.history.replaceState(null, "", "/admin/products");
  saved = draft();
  prepared = null;
  requests = [];
  override = undefined;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/categories") return Response.json(categories);
    if (url.pathname === "/products") return Response.json(apiPage([1, 2]));
    const request = {
      path: url.pathname.replace("/admin/product-drafts", ""),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : {},
    };
    requests.push(request);
    const custom = override?.(request);
    if (custom) return custom;
    if (!request.path && request.method === "GET") {
      const {
        state: _state,
        context: _context,
        attachments: _attachments,
        ...summary
      } = saved;
      return Response.json({ drafts: [summary] });
    }
    if (!request.path && request.method === "POST")
      return Response.json(
        draft({
          id: otherId,
          target: request.body.target as ProductDraft["target"],
        }),
      );
    if (request.path.endsWith("/pricing/prepare")) {
      prepared = preparation(request.body.action as Action, {
        draftRevision: saved.revision,
      });
      return Response.json({ preparation: prepared });
    }
    if (request.path.endsWith("/preparation"))
      return Response.json({ preparation: prepared });
    if (request.path.endsWith("/operation"))
      return Response.json({
        operation: null,
        product: null,
        readiness: null,
        storefrontVisible: false,
      });
    if (request.path.endsWith("/prepare")) {
      saved = draft({
        ...saved,
        revision: saved.revision + 1,
        state: {
          ...saved.state,
          answers: { ...saved.state.answers, ...request.body.answers },
        },
      });
      return Response.json(saved);
    }
    if (request.path.endsWith("/submit") || request.path.endsWith("/reconcile"))
      return Response.json(
        mutationResult(
          (request.body.action ??
            prepared?.snapshot?.action ??
            "create") as Action,
        ),
      );
    if (request.path === `/${saved.id}` || request.path === `/${otherId}`)
      return Response.json(
        request.path === `/${otherId}`
          ? draft({ id: otherId, target: { kind: "existing", productId: 42 } })
          : saved,
      );
    return Response.json({ error: "Unexpected request" }, { status: 404 });
  });
});
const writes = () => requests.filter((request) => request.method !== "GET");
const review = () =>
  screen.findByRole("button", { name: /^Review product( changes)?$/ });
const submit = (action: Action = "create") =>
  screen.getByRole("button", {
    name:
      action === "create"
        ? "Create product"
        : action === "delete"
          ? "Delete product"
          : /Save changes|Update product/,
  });

it("reviews dirty answers at their saved revision and creates only after explicit confirmation", async () => {
  renderWithClient(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit draft facts" }),
  );
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Reviewed name" },
  });
  fireEvent.click(await review());
  await waitFor(() => expect(submit()).toBeEnabled());
  expect(writes()).toEqual([
    {
      path: `/${draftId}/prepare`,
      method: "POST",
      body: { expectedRevision: 1, answers: { name: "Reviewed name" } },
    },
    {
      path: `/${draftId}/pricing/prepare`,
      method: "POST",
      body: { expectedRevision: 2, action: "create" },
    },
  ]);
  fireEvent.click(submit());
  await screen.findByRole("region", { name: "Product completion" });
  expect(writes().at(-1)).toEqual({
    path: `/${draftId}/submit`,
    method: "POST",
    body: { expectedRevision: 2, preparationId, action: "create" },
  });
  expect(screen.queryByRole("region", { name: "Product Card" })).toBeNull();
  expect(screen.getByLabelText("Product notes")).toBeEnabled();
});

it.each(["blocked", "unavailable", "stale"] as const)(
  "does not submit a %s preparation",
  async (status) => {
    prepared = preparation("create", {
      status,
      readiness: { ready: false, submissionAuthorized: false },
    });
    renderWithClient(<App />);
    await review();
    expect(submit()).toBeDisabled();
    fireEvent.click(submit());
    expect(writes()).toHaveLength(0);
  },
);

it.each([
  { action: "create" as const, revision: 2 },
  { action: "update" as const, revision: 1 },
])(
  "rejects ready snapshot action $action at revision $revision, including forged A2UI submit actions",
  async ({ action, revision }) => {
    prepared = preparation(action, { draftRevision: revision });
    const dispatch = vi.spyOn(SurfaceModel.prototype, "dispatchAction");
    renderWithClient(<App />);
    await review();
    expect(submit()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Correct a detail"), {
      target: { value: "name" },
    });
    const surface = dispatch.mock.contexts.find(
      (context) => context instanceof SurfaceModel,
    );
    if (!(surface instanceof SurfaceModel))
      throw Error("Expected A2UI surface");
    await act(() =>
      surface.dispatchAction(
        { event: { name: "submit", context: { draftId, action: "create" } } },
        "root",
      ),
    );
    expect(writes()).toHaveLength(0);
  },
);

it("requires a new review after local input changes", async () => {
  prepared = preparation();
  renderWithClient(<App />);
  await review();
  await waitFor(() => expect(submit()).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Correct a detail"), {
    target: { value: "name" },
  });
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Changed after review" },
  });
  expect(submit()).toBeDisabled();
  fireEvent.click(submit());
  expect(writes()).toHaveLength(0);
});

it.each(["update", "delete"] as const)(
  "requires explicit review and submit for %s",
  async (action) => {
    saved = draft({
      target: { kind: "existing", productId: 42 },
      context: { status: "unavailable", productId: 42 },
    });
    renderWithClient(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit draft facts" }),
    );
    await review();
    expect(writes()).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", {
        name:
          action === "delete"
            ? "Review product deletion"
            : /^Review product( changes)?$/,
      }),
    );
    await waitFor(() => expect(submit(action)).toBeEnabled());
    expect(writes()).toEqual([
      {
        path: `/${draftId}/pricing/prepare`,
        method: "POST",
        body: { expectedRevision: 1, action },
      },
    ]);
    fireEvent.click(submit(action));
    await waitFor(() =>
      expect(writes().at(-1)?.path).toBe(`/${draftId}/submit`),
    );
    expect(writes().at(-1)?.body).toEqual({
      expectedRevision: 1,
      preparationId,
      action,
    });
  },
);

it.each(["lost response", "temporary failure"])(
  "reads the saved operation after submit %s and reconciles only its explicit ID",
  async (failure) => {
    prepared = preparation();
    let submitted = false;
    const result = mutationResult();
    if (!result.operation) throw Error("Expected operation fixture");
    const pending = {
      ...result,
      operation: {
        ...result.operation,
        state: "repair_required" as const,
        retryable: true,
      },
      product: null,
      readiness: null,
      storefrontVisible: false,
    };
    override = (request) => {
      if (request.path.endsWith("/submit")) {
        submitted = true;
        return failure === "lost response"
          ? Promise.reject(new Error("Submit response lost"))
          : Response.json({ error: "Submit unavailable" }, { status: 503 });
      }
      if (submitted && request.path.endsWith("/operation"))
        return Response.json(pending);
    };
    const dispatch = vi.spyOn(SurfaceModel.prototype, "dispatchAction");
    renderWithClient(<App />);
    await review();
    await waitFor(() => expect(submit()).toBeEnabled());
    fireEvent.click(submit());
    const reconcile = await screen.findByRole("button", {
      name: /Resolve saved operation|Check product operation/,
    });
    const submitIndex = requests.findIndex((request) =>
      request.path.endsWith("/submit"),
    );
    expect(
      requests
        .slice(submitIndex + 1)
        .some(
          (request) =>
            request.method === "GET" && request.path.endsWith("/operation"),
        ),
    ).toBe(true);
    expect(writes().map((request) => request.path)).toEqual([
      `/${draftId}/submit`,
    ]);
    expect(submit()).toBeDisabled();
    const surface = dispatch.mock.instances[0];
    if (!(surface instanceof SurfaceModel))
      throw Error("Expected A2UI surface");
    await act(() =>
      surface.dispatchAction(
        {
          event: {
            name: "reconcile",
            context: { draftId, operationId: otherId },
          },
        },
        "root",
      ),
    );
    expect(writes()).toHaveLength(1);
    fireEvent.click(reconcile);
    await waitFor(() =>
      expect(writes().at(-1)).toEqual({
        path: `/${draftId}/reconcile`,
        method: "POST",
        body: { operationId },
      }),
    );
    await screen.findByRole("region", { name: "Product completion" });
  },
);

it("does not continue review pricing after a dirty save response arrives following sign-out", async () => {
  let resolveSave: ((response: Response) => void) | undefined;
  override = (request) =>
    request.path.endsWith("/prepare") &&
    !request.path.endsWith("/pricing/prepare")
      ? new Promise<Response>((resolve) => {
          resolveSave = resolve;
        })
      : undefined;
  const rendered = renderWithClient(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit draft facts" }),
  );
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Private edit" },
  });
  fireEvent.click(await review());
  await waitFor(() => expect(resolveSave).toBeDefined());
  session.data = null;
  rendered.rerender(<App />);
  await act(() => resolveSave?.(Response.json(draft({ revision: 2 }))));
  expect(writes().map((request) => request.path)).toEqual([
    `/${draftId}/prepare`,
  ]);
  expect(screen.queryByRole("button", { name: "Create product" })).toBeNull();
});

it.each([401, 403])(
  "does not continue a review after save authorization denial (%s)",
  async (status) => {
    override = (request) =>
      request.path.endsWith("/prepare") &&
      !request.path.endsWith("/pricing/prepare")
        ? Response.json({ error: "Access denied" }, { status })
        : undefined;
    renderWithClient(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit draft facts" }),
    );
    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: "Private edit" },
    });
    fireEvent.click(await review());
    await screen.findByRole("alert");
    expect(writes().map((request) => request.path)).toEqual([
      `/${draftId}/prepare`,
    ]);
    expect(screen.queryByRole("button", { name: "Create product" })).toBeNull();
  },
);

it("loads a completed but unmapped catalog outcome without publishing or repeating writes", async () => {
  const result = mutationResult();
  if (!result.readiness) throw Error("Expected readiness fixture");
  const unmapped = {
    ...result,
    readiness: {
      ...result.readiness,
      checkoutReady: false,
      reasons: ["unavailable_filament_id"],
    },
    storefrontVisible: false,
  };
  override = (request) =>
    request.path.endsWith("/operation") ? Response.json(unmapped) : undefined;
  renderWithClient(<App />);
  await screen.findByRole("region", { name: "Product completion" });
  expect(
    screen.getAllByText(
      /Not visible in the storefront.*Checkout not ready: unavailable_filament_id/,
    ).length,
  ).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Create product" })).toBeNull();
  expect(writes()).toHaveLength(0);
});

it.each([
  "prepared",
  "pending",
  "item_confirmed",
  "square_confirmed",
  "repair_required",
] as const)(
  "restores saved %s evidence without replay and reconciles the same operation explicitly",
  async (state) => {
    const result = mutationResult();
    if (!result.operation) throw Error("Expected operation fixture");
    const pending = {
      ...result,
      operation: { ...result.operation, state, retryable: true },
      product: null,
      readiness: null,
      storefrontVisible: false,
    };
    override = (request) =>
      request.path.endsWith("/operation") ? Response.json(pending) : undefined;
    renderWithClient(<App />);
    const reconcile = await screen.findByRole("button", {
      name: /Resolve saved operation|Check product operation/,
    });
    expect(submit()).toBeDisabled();
    expect(writes()).toHaveLength(0);
    fireEvent.click(reconcile);
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          path: `/${draftId}/reconcile`,
          method: "POST",
          body: { operationId },
        },
      ]),
    );
    await screen.findByRole("region", { name: "Product completion" });
  },
);

it("restores a failed operation as saved failure evidence without replaying submission", async () => {
  const result = mutationResult();
  if (!result.operation) throw Error("Expected operation fixture");
  override = (request) =>
    request.path.endsWith("/operation")
      ? Response.json({
          ...result,
          operation: {
            ...result.operation,
            state: "failed",
            error: "Square rejected saved operation",
            retryable: false,
          },
          product: null,
          readiness: null,
          storefrontVisible: false,
        })
      : undefined;
  renderWithClient(<App />);
  await screen.findByText(/Square rejected saved operation/);
  expect(writes()).toHaveLength(0);
  expect(
    screen.queryByRole("button", {
      name: /Resolve saved operation|Check product operation/,
    }),
  ).toBeNull();
});

it("keeps a lost submission unresolved when the operation read returns null", async () => {
  prepared = preparation();
  override = (request) =>
    request.path.endsWith("/submit")
      ? Promise.reject(new Error("Submit response lost"))
      : undefined;
  renderWithClient(<App />);
  await review();
  await waitFor(() => expect(submit()).toBeEnabled());
  fireEvent.click(submit());
  await screen.findByText(
    /Submit response lost The product operation outcome is unresolved/,
  );
  expect(submit()).toBeDisabled();
  expect(
    screen.queryByRole("button", {
      name: /Resolve saved operation|Check product operation/,
    }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reload saved state" }));
  await screen.findByText(
    "The product operation outcome is unresolved. Reload saved state before retrying.",
  );
  expect(submit()).toBeDisabled();
  expect(writes().map((request) => request.path)).toEqual([
    `/${draftId}/submit`,
  ]);
});

it("does not reconcile or manage another draft's operation returned in the same session", async () => {
  prepared = preparation();
  const result = mutationResult();
  if (!result.operation) throw Error("Expected operation fixture");
  override = (request) =>
    request.path.endsWith("/operation")
      ? Response.json({
          ...result,
          operation: {
            ...result.operation,
            draftId: otherId,
            state: "repair_required",
            retryable: true,
          },
        })
      : undefined;
  const dispatch = vi.spyOn(SurfaceModel.prototype, "dispatchAction");
  renderWithClient(<App />);
  await review();
  expect(
    screen.queryByRole("button", {
      name: /Resolve saved operation|Check product operation/,
    }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Manage created product" }),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText("Correct a detail"), {
    target: { value: "name" },
  });
  const surface = dispatch.mock.contexts.find(
    (context) => context instanceof SurfaceModel,
  );
  if (!(surface instanceof SurfaceModel)) throw Error("Expected A2UI surface");
  await act(() =>
    surface.dispatchAction(
      { event: { name: "reconcile", context: { draftId, operationId } } },
      "root",
    ),
  );
  expect(writes()).toHaveLength(0);
});

it("does not resubmit the same preparation after a saved update has succeeded", async () => {
  saved = draft({
    target: { kind: "existing", productId: 42 },
    context: { status: "unavailable", productId: 42 },
  });
  prepared = preparation("update");
  override = (request) => {
    if (request.path.endsWith("/operation"))
      return Response.json(mutationResult("update"));
    if (request.path.endsWith("/pricing/prepare"))
      return Response.json({
        preparation: preparation("update", { id: otherId }),
      });
  };
  renderWithClient(<App />);
  await screen.findByRole("region", { name: "Product completion" });
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Edit product details" }));
  expect(submit("update")).toBeDisabled();
  fireEvent.click(await review());
  await waitFor(() => expect(submit("update")).toBeEnabled());
  fireEvent.click(submit("update"));
  await waitFor(() =>
    expect(writes().at(-1)?.body).toEqual({
      expectedRevision: 1,
      preparationId: otherId,
      action: "update",
    }),
  );
});

it("keeps a lost second update unresolved until evidence matches its preparation", async () => {
  saved = draft({
    target: { kind: "existing", productId: 42 },
    context: { status: "unavailable", productId: 42 },
  });
  prepared = preparation("update", { id: otherId });
  const prior = mutationResult("update");
  if (!prior.operation) throw Error("Expected operation fixture");
  const matching = {
    ...prior,
    operation: {
      ...prior.operation,
      id: otherId,
      preparationId: otherId,
      state: "repair_required" as const,
      retryable: true,
    },
    product: null,
    readiness: null,
    storefrontVisible: false,
  };
  let discoverMatching = false;
  override = (request) => {
    if (request.path.endsWith("/operation"))
      return Response.json(discoverMatching ? matching : prior);
    if (request.path.endsWith("/submit"))
      return Promise.reject(new Error("Second update response lost"));
    if (request.path.endsWith("/reconcile"))
      return Response.json({
        ...prior,
        operation: { ...prior.operation, id: otherId, preparationId: otherId },
      });
  };
  renderWithClient(<App />);
  await review();
  await waitFor(() => expect(submit("update")).toBeEnabled());
  fireEvent.click(submit("update"));
  await waitFor(() =>
    expect(
      screen.getByRole("status", { name: "Draft status" }),
    ).toHaveTextContent(/unresolved/),
  );
  expect(submit("update")).toBeDisabled();
  expect(
    screen.queryByRole("button", {
      name: /Resolve saved operation|Check product operation/,
    }),
  ).toBeNull();
  expect(writes().map((request) => request.path)).toEqual([
    `/${draftId}/submit`,
  ]);

  discoverMatching = true;
  fireEvent.click(screen.getByRole("button", { name: "Reload saved state" }));
  const reconcile = await screen.findByRole("button", {
    name: /Resolve saved operation|Check product operation/,
  });
  fireEvent.click(reconcile);
  await waitFor(() =>
    expect(writes().at(-1)).toEqual({
      path: `/${draftId}/reconcile`,
      method: "POST",
      body: { operationId: otherId },
    }),
  );
});

it("refreshes the saved draft and catalog after lost submission is proven succeeded", async () => {
  prepared = preparation();
  let submitted = false;
  let evidenceReads = 0;
  let catalogRefreshes = 0;
  override = (request) => {
    if (request.path.endsWith("/submit")) {
      submitted = true;
      return Promise.reject(new Error("Committed response lost"));
    }
    if (submitted && request.path.endsWith("/operation")) {
      evidenceReads++;
      saved = draft({
        revision: 2,
        state: {
          answers: { name: "Saved catalog part" },
          history: [],
          pendingQuestions: [],
        },
      });
      return Response.json(mutationResult());
    }
  };
  const adminFetch = vi.mocked(fetch).getMockImplementation();
  if (!adminFetch) throw Error("Expected fetch fixture");
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (new URL(String(input)).pathname === "/products" && evidenceReads > 0)
      catalogRefreshes++;
    return adminFetch(input, init);
  });
  renderWithClient(<App />);
  await review();
  await waitFor(() => expect(submit()).toBeEnabled());
  fireEvent.click(submit());
  await screen.findByRole("region", { name: "Product completion" });
  const evidenceIndex = requests
    .map((request) => request.path)
    .lastIndexOf(`/${draftId}/operation`);
  await waitFor(() =>
    expect(
      requests
        .slice(evidenceIndex + 1)
        .some(
          (request) =>
            request.method === "GET" && request.path === `/${draftId}`,
        ),
    ).toBe(true),
  );
  await waitFor(() => expect(catalogRefreshes).toBeGreaterThan(0));
  await screen.findByRole("heading", { name: "Saved catalog part", level: 2 });
  expect(writes().map((request) => request.path)).toEqual([
    `/${draftId}/submit`,
  ]);
});

it("switches a reviewed deletion back to an explicit update without deleting the product", async () => {
  saved = draft({
    target: { kind: "existing", productId: 42 },
    context: { status: "unavailable", productId: 42 },
  });
  renderWithClient(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit draft facts" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Review product deletion" }),
  );
  await waitFor(() => expect(submit("delete")).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Cancel deletion" }));
  expect(writes()).toHaveLength(1);
  expect(submit("update")).toBeDisabled();
  fireEvent.click(await review());
  await waitFor(() => expect(submit("update")).toBeEnabled());
  expect(screen.queryByRole("button", { name: "Delete product" })).toBeNull();
  fireEvent.click(submit("update"));
  await waitFor(() =>
    expect(writes().at(-1)?.body).toEqual({
      expectedRevision: 1,
      preparationId,
      action: "update",
    }),
  );
  expect(writes().map((request) => request.body.action)).toEqual([
    "delete",
    "update",
    "update",
  ]);
});

it("shows blocked server validation when pricing and the prepared snapshot are unavailable", async () => {
  const prices = preparation().pricing;
  prepared = preparation("create", {
    status: "blocked",
    snapshot: null,
    readiness: { ready: false, submissionAuthorized: false },
    pricing: {
      ...prices,
      productionCost: null,
      onlinePrice: null,
      inPersonPrice: null,
    },
    validation: [
      {
        field: "stl",
        code: "required",
        message: "Save a print file before creating the product.",
      },
    ],
  });
  renderWithClient(<App />);
  await review();
  expect(screen.getByText(/Review unavailable/)).toHaveTextContent(
    "Production cost: Unavailable",
  );
  expect(screen.getByText(/Review unavailable/)).toHaveTextContent(
    "Online price: Unavailable",
  );
  expect(screen.getByText(/Review unavailable/)).toHaveTextContent(
    "In-person price: Unavailable",
  );
  expect(screen.getByText(/Review unavailable/)).toHaveTextContent(
    "Save a print file before creating the product.",
  );
  expect(submit()).toBeDisabled();
  expect(writes()).toHaveLength(0);
});

it.each([null, []])(
  "reports missing checkout readiness evidence honestly (%s)",
  async (reasons) => {
    const result = mutationResult();
    override = (request) =>
      request.path.endsWith("/operation")
        ? Response.json({
            ...result,
            storefrontVisible: false,
            readiness:
              reasons === null
                ? null
                : { ...result.readiness, checkoutReady: false, reasons },
          })
        : undefined;
    renderWithClient(<App />);
    await screen.findByRole("region", { name: "Product completion" });
    expect(
      screen.getByText(/Checkout not ready: readiness unavailable/),
    ).toBeVisible();
    expect(writes()).toHaveLength(0);
  },
);

it.each(["new", "existing"] as const)(
  "rejects a forged review action for a %s target",
  async (target) => {
    if (target === "existing")
      saved = draft({
        target: { kind: "existing", productId: 42 },
        context: { status: "unavailable", productId: 42 },
      });
    const dispatch = vi.spyOn(SurfaceModel.prototype, "dispatchAction");
    renderWithClient(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit draft facts" }),
    );
    fireEvent.change(screen.getByLabelText("Correct a detail"), {
      target: { value: "name" },
    });
    const surface = dispatch.mock.contexts.find(
      (context) => context instanceof SurfaceModel,
    );
    if (!(surface instanceof SurfaceModel))
      throw Error("Expected A2UI surface");
    for (const action of ["forged", target === "new" ? "update" : "create"])
      await act(() =>
        surface.dispatchAction(
          { event: { name: "review", context: { draftId, action } } },
          "root",
        ),
      );
    expect(writes()).toHaveLength(0);
  },
);

it("rejects a forged manage product ID after a confirmed creation", async () => {
  prepared = preparation();
  const dispatch = vi.spyOn(SurfaceModel.prototype, "dispatchAction");
  renderWithClient(<App />);
  await review();
  await waitFor(() => expect(submit()).toBeEnabled());
  fireEvent.click(submit());
  await screen.findByRole("region", { name: "Product completion" });
  const surface = dispatch.mock.contexts.find(
    (context) => context instanceof SurfaceModel,
  );
  if (!(surface instanceof SurfaceModel)) throw Error("Expected A2UI surface");
  await act(() =>
    surface.dispatchAction(
      { event: { name: "manage", context: { draftId, productId: 999 } } },
      "root",
    ),
  );
  expect(writes().map((request) => request.path)).toEqual([
    `/${draftId}/submit`,
  ]);
});

it("keeps a successful HTTP submission unresolved when its body has no saved operation", async () => {
  prepared = preparation();
  override = (request) =>
    request.path.endsWith("/submit")
      ? Response.json({
          operation: null,
          product: null,
          readiness: null,
          storefrontVisible: false,
        })
      : undefined;
  renderWithClient(<App />);
  await review();
  await waitFor(() => expect(submit()).toBeEnabled());
  fireEvent.click(submit());
  await screen.findByText(
    "The product operation outcome is unresolved. Reload saved state before retrying.",
  );
  expect(submit()).toBeDisabled();
  expect(writes().map((request) => request.path)).toEqual([
    `/${draftId}/submit`,
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Reload saved state" }));
  await waitFor(() =>
    expect(
      screen.getByRole("status", { name: "Draft status" }),
    ).toHaveTextContent("outcome is unresolved"),
  );
  expect(submit()).toBeDisabled();
});

it("keeps lost reconciliation unresolved when evidence changes the confirmed operation ID", async () => {
  const result = mutationResult();
  if (!result.operation) throw Error("Expected operation fixture");
  const pending = {
    ...result,
    operation: {
      ...result.operation,
      state: "repair_required",
      retryable: true,
    },
    product: null,
    readiness: null,
    storefrontVisible: false,
  };
  let lost = false;
  let correctEvidence = false;
  override = (request) => {
    if (request.path.endsWith("/operation"))
      return Response.json({
        ...pending,
        operation: {
          ...pending.operation,
          id: lost && !correctEvidence ? otherId : operationId,
        },
      });
    if (request.path.endsWith("/reconcile")) {
      if (!lost) {
        lost = true;
        return Promise.reject(new Error("Reconcile response lost"));
      }
      return Response.json(result);
    }
  };
  renderWithClient(<App />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: /Resolve saved operation|Check product operation/,
    }),
  );
  await screen.findByText(
    /Reconcile response lost The product operation outcome is unresolved/,
  );
  expect(
    screen.queryByRole("button", {
      name: /Resolve saved operation|Check product operation/,
    }),
  ).toBeNull();
  correctEvidence = true;
  fireEvent.click(screen.getByRole("button", { name: "Reload saved state" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: /Resolve saved operation|Check product operation/,
    }),
  );
  await screen.findByRole("region", { name: "Product completion" });
  expect(writes().map((request) => request.body)).toEqual([
    { operationId },
    { operationId },
  ]);
});

it.each(["create", "delete"] as const)(
  "leaves a completed %s locked while allowing another conversation and a new product",
  async (action) => {
    if (action === "delete")
      saved = draft({
        target: { kind: "existing", productId: 42 },
        context: { status: "unavailable", productId: 42 },
      });
    saved.attachments.photos = [
      photo({ imageUrl: "/catalog/assets/removed/image" }),
    ];
    saved.attachments.photoOrder = saved.attachments.photos.map(
      (item) => item.id,
    );
    saved.attachments.primaryPhotoId = photo().id;
    prepared = preparation(action);
    const recent = draft({
      id: otherId,
      target: { kind: "existing", productId: 7 },
      context: { status: "unavailable", productId: 7 },
    });
    override = (request) => {
      if (!request.path && request.method === "GET")
        return Response.json({
          drafts: [saved, recent].map(
            ({
              state: _state,
              context: _context,
              attachments: _attachments,
              ...summary
            }) => summary,
          ),
        });
      if (request.path === `/${draftId}/operation`)
        return Response.json(mutationResult(action));
      if (request.path === `/${otherId}`) return Response.json(recent);
      if (
        request.path.endsWith("/preparation") &&
        !request.path.startsWith(`/${draftId}/`)
      )
        return Response.json({ preparation: null });
      if (!request.path && request.method === "POST")
        return Response.json(draft({ id: operationId }));
      if (request.path === `/${operationId}`)
        return Response.json(draft({ id: operationId }));
    };
    renderWithClient(<App />);
    await screen.findByText(
      action === "create" ? /Product created\./ : /Product deleted\./,
    );
    await screen.findByRole("region", { name: "Product completion" });
    expect(screen.queryByRole("region", { name: "Product Card" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Discard draft" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "+ New product" })).toBeEnabled();
    const conversations = within(
      screen.getByRole("complementary", { name: "Recent conversations" }),
    );
    const recentButton = conversations.getByRole("button", {
      name: /Product #7\s*Unfinished/,
    });
    expect(recentButton).toBeEnabled();
    fireEvent.click(recentButton);
    await screen.findByRole("heading", { name: "Product #7", level: 1 });
    expect(
      await screen.findByRole("button", { name: "Edit draft facts" }),
    ).toBeEnabled();
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "+ New product" }));
    await screen.findByLabelText("Product name");
    expect(writes()).toEqual([
      {
        path: "",
        method: "POST",
        body: { requestKey: expect.any(String), target: { kind: "new" } },
      },
    ]);
    expect(screen.getByLabelText("Product name")).toBeEnabled();
  },
);

it("retains current catalog markup while reviewing an unrelated existing product correction", async () => {
  saved = draft({
    target: { kind: "existing", productId: 42 },
    context: {
      status: "available",
      product: {
        id: 42,
        name: "Current part",
        description: "Current description",
        image: null,
        price: 15,
        markupPercentage: 50,
        filamentType: "PLA",
        color: "Red",
        skuNumber: null,
        publicFileServiceId: "file-42",
      },
      categories: [],
    },
  });
  renderWithClient(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit draft facts" }),
  );
  fireEvent.change(screen.getByLabelText("Correct a detail"), {
    target: { value: "markupPercentage" },
  });
  expect(screen.getByLabelText("Online markup percentage")).toHaveValue("50");
  fireEvent.change(screen.getByLabelText("Correct a detail"), {
    target: { value: "name" },
  });
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Corrected part name" },
  });
  fireEvent.click(await review());
  await waitFor(() => expect(submit("update")).toBeEnabled());
  expect(writes()[0]?.body.answers).toMatchObject({
    name: "Corrected part name",
    markupPercentage: "50",
  });
  expect(writes()[1]?.body).toEqual({ expectedRevision: 2, action: "update" });
});

it("keeps reconciliation unresolved when HTTP success returns another operation", async () => {
  const result = mutationResult();
  if (!result.operation) throw Error("Expected operation fixture");
  const pending = {
    ...result,
    operation: {
      ...result.operation,
      state: "repair_required",
      retryable: true,
    },
    product: null,
    readiness: null,
    storefrontVisible: false,
  };
  let reconciled = false;
  override = (request) => {
    if (request.path.endsWith("/operation"))
      return Response.json({
        ...pending,
        operation: {
          ...pending.operation,
          id: reconciled ? otherId : operationId,
        },
      });
    if (request.path.endsWith("/reconcile")) {
      reconciled = true;
      return Response.json({
        ...result,
        operation: { ...result.operation, id: otherId },
      });
    }
  };
  renderWithClient(<App />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: /Resolve saved operation|Check product operation/,
    }),
  );
  await screen.findByText(
    /Product operation evidence does not match the confirmed action.*outcome is unresolved/,
  );
  expect(submit()).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Manage created product" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", {
      name: /Resolve saved operation|Check product operation/,
    }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reload saved state" }));
  await screen.findByText(
    "The product operation outcome is unresolved. Reload saved state before retrying.",
  );
  expect(writes()).toEqual([
    { path: `/${draftId}/reconcile`, method: "POST", body: { operationId } },
  ]);
});

it("rejects forged normal catalog actions after creation has completed", async () => {
  prepared = preparation();
  const dispatch = vi.spyOn(SurfaceModel.prototype, "dispatchAction");
  renderWithClient(<App />);
  await review();
  await waitFor(() => expect(submit()).toBeEnabled());
  fireEvent.click(submit());
  await screen.findByRole("region", { name: "Product completion" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "+ New product" })).toBeEnabled(),
  );
  expect(screen.queryByRole("button", { name: "Create product" })).toBeNull();
  const surface = dispatch.mock.contexts.find(
    (context) => context instanceof SurfaceModel,
  );
  if (!(surface instanceof SurfaceModel)) throw Error("Expected A2UI surface");
  for (const name of ["review", "submit"])
    await act(() =>
      surface.dispatchAction(
        { event: { name, context: { draftId, action: "create" } } },
        "root",
      ),
    );
  expect(writes().map((request) => request.path)).toEqual([
    `/${draftId}/submit`,
  ]);
});

it("restores an unconfirmed deletion with exact identity and cancels without a write", async () => {
  saved = draft({
    target: { kind: "existing", productId: 42 },
    context: {
      status: "available",
      product: {
        id: 42,
        name: "Prepared part",
        description: "Part",
        price: 15,
        image: "https://api.lulu.test/part.png",
        filamentType: "PLA",
        color: "Red",
        skuNumber: "SKU-42",
        publicFileServiceId: "file-42",
      },
      categories: [],
    },
  });
  prepared = preparation("delete");
  if (!prepared.snapshot) throw Error("Expected snapshot");
  prepared.snapshot.image = "https://api.lulu.test/part.png";
  renderWithClient(<App />);
  const confirmation = await screen.findByRole("region", {
    name: "Confirm product deletion",
  });
  expect(confirmation).toHaveTextContent("Delete Prepared part?");
  expect(confirmation).toHaveTextContent("Product #42 · SKU SKU-42");
  expect(within(confirmation).getByRole("img")).toHaveAttribute(
    "src",
    "https://api.lulu.test/part.png",
  );
  expect(writes()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Cancel deletion" }));
  expect(
    screen.queryByRole("region", { name: "Confirm product deletion" }),
  ).toBeNull();
  expect(writes()).toEqual([]);
  expect(screen.queryByRole("button", { name: "Delete product" })).toBeNull();
});

it.each([false, true])(
  "continues created product chat in an immutable existing-target conversation (reuse=%s)",
  async (reuse) => {
    let existing = draft({
      id: otherId,
      target: { kind: "existing", productId: 42 },
    });
    override = (request) => {
      if (request.path === `/${draftId}/operation`)
        return Response.json(mutationResult());
      if (reuse && !request.path && request.method === "GET")
        return Response.json({
          drafts: [saved, existing].map(
            ({
              state: _state,
              context: _context,
              attachments: _attachments,
              ...summary
            }) => summary,
          ),
        });
      if (request.path === `/${otherId}`) return Response.json(existing);
      if (request.path === `/${otherId}/prepare`) {
        existing = draft({
          ...existing,
          revision: 2,
          state: {
            answers: {},
            pendingQuestions: [],
            history: [{ role: "user", content: String(request.body.message) }],
          },
        });
        return Response.json(existing);
      }
      if (request.path === `/${otherId}/pricing/prepare`) {
        prepared = preparation("update", { id: otherId, draftRevision: 2 });
        return Response.json({ preparation: prepared });
      }
    };
    renderWithClient(<App />);
    await screen.findByRole("region", { name: "Product completion" });
    expect(writes()).toEqual([]);
    fireEvent.change(screen.getByLabelText("Product notes"), {
      target: { value: "Make the description clearer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send instruction" }));
    await waitFor(() => expect(submit("update")).toBeEnabled());
    expect(
      screen.getByRole("list", { name: "Conversation history" }),
    ).toHaveTextContent("Make the description clearer");
    expect(writes().filter((r) => !r.path)).toHaveLength(reuse ? 0 : 1);
    expect(writes().filter((r) => r.path.endsWith("/submit"))).toEqual([]);
    expect(
      writes().find((r) => r.path === `/${otherId}/prepare`)?.body,
    ).toEqual({
      expectedRevision: 1,
      answers: {},
      message: "Make the description clearer",
    });
    expect(saved.target).toEqual({ kind: "new" });
    expect(
      screen.queryByRole("region", { name: "Product completion" }),
    ).toBeNull();
  },
);

it("refreshes the server price after saved corrections and hides stale prices while dirty", async () => {
  prepared = preparation();
  renderWithClient(<App />);
  await review();
  expect(screen.getByText(/Proposed online price:/)).toHaveTextContent(
    "Proposed online price: $15.00",
  );
  fireEvent.change(screen.getByLabelText("Correct a detail"), {
    target: { value: "markupPercentage" },
  });
  fireEvent.change(screen.getByLabelText("Online markup percentage"), {
    target: { value: "75" },
  });
  expect(screen.getByText(/Proposed online price:/)).toHaveTextContent(
    "awaiting server calculation",
  );
  override = (request) =>
    request.path.endsWith("/pricing/prepare")
      ? Response.json({
          preparation: preparation("create", {
            id: otherId,
            draftRevision: 2,
            pricing: {
              ...preparation().pricing,
              onlinePrice: 17.5,
              markupPercentage: 75,
            },
          }),
        })
      : undefined;
  fireEvent.click(screen.getByRole("button", { name: "Save draft answers" }));
  await waitFor(() =>
    expect(screen.getByText(/Proposed online price:/)).toHaveTextContent(
      "Proposed online price: $17.50",
    ),
  );
  expect(writes().map((r) => r.path)).toEqual([
    `/${draftId}/prepare`,
    `/${draftId}/pricing/prepare`,
  ]);
  expect(submit()).toBeEnabled();
});

it.each(["creation", "message"] as const)(
  "retains follow-up notes after a lost %s response without repeating product creation",
  async (failure) => {
    let linked = draft({
      id: otherId,
      target: { kind: "existing", productId: 42 },
    });
    let failed = false;
    override = (request) => {
      if (request.path === `/${draftId}/operation`)
        return Response.json(mutationResult());
      if (
        request.path === "" &&
        request.method === "POST" &&
        failure === "creation"
      )
        return Response.json(
          { error: "Lost acknowledgement" },
          { status: 503 },
        );
      if (
        request.path.startsWith("/by-request-key/") ||
        request.path === `/${otherId}`
      )
        return Response.json(linked);
      if (request.path === `/${otherId}/prepare`) {
        if (failure === "message" && !failed) {
          failed = true;
          return Response.json(
            { error: "Retry the instruction" },
            { status: 503 },
          );
        }
        linked = draft({ ...linked, revision: 2 });
        return Response.json(linked);
      }
      if (request.path === `/${otherId}/pricing/prepare`) {
        prepared = preparation("update", { id: otherId, draftRevision: 2 });
        return Response.json({ preparation: prepared });
      }
    };
    renderWithClient(<App />);
    await screen.findByRole("region", { name: "Product completion" });
    fireEvent.change(screen.getByLabelText("Product notes"), {
      target: { value: "Keep these follow-up notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send instruction" }));
    await screen.findByText(
      failure === "creation"
        ? "The original conversation has been recovered."
        : /Retry the instruction.*Saved state has been reloaded/,
    );
    expect(screen.getByLabelText("Product notes")).toHaveValue(
      "Keep these follow-up notes",
    );
    expect(writes().filter((r) => !r.path)).toHaveLength(1);
    expect(writes().filter((r) => r.path.endsWith("/submit"))).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Send instruction" }));
    await waitFor(() => expect(submit("update")).toBeEnabled());
    expect(writes().filter((r) => !r.path)).toHaveLength(1);
    expect(screen.getByLabelText("Product notes")).toHaveValue("");
  },
);

it.each([false, true])(
  "does not continue a held product handoff after leaving the visit (reuse=%s)",
  async (reuse) => {
    const linked = draft({
      id: otherId,
      target: { kind: "existing", productId: 42 },
    });
    let release: ((value: Response) => void) | undefined;
    override = (request) => {
      if (request.path === `/${draftId}/operation`)
        return Response.json(mutationResult());
      if (reuse && !request.path && request.method === "GET")
        return Response.json({
          drafts: [saved, linked].map(
            ({
              state: _state,
              context: _context,
              attachments: _attachments,
              ...summary
            }) => summary,
          ),
        });
      if (
        reuse
          ? request.path === `/${otherId}`
          : !request.path && request.method === "POST"
      )
        return new Promise((resolve) => {
          release = resolve;
        });
    };
    renderWithClient(<App />);
    await screen.findByRole("region", { name: "Product completion" });
    fireEvent.change(screen.getByLabelText("Product notes"), {
      target: { value: "This belongs to the old visit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send instruction" }));
    await waitFor(() => expect(release).toBeDefined());
    act(() => {
      window.history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() =>
      expect(screen.queryByLabelText("Product notes")).toBeNull(),
    );
    await act(() => release?.(Response.json(linked)));
    expect(writes().filter((r) => r.path.endsWith("/prepare"))).toEqual([]);
    expect(screen.queryByLabelText("Product notes")).toBeNull();
  },
);

it("prepares a chat-requested deletion without authorizing it", async () => {
  saved = draft({
    target: { kind: "existing", productId: 42 },
    state: {
      answers: {},
      history: [],
      pendingQuestions: [],
      interpretation: {
        intent: "delete",
        status: "prepared",
        explanation: "Review this deletion",
        confirmedCategoryNames: [],
        proposedCategoryNames: [],
        productionOptions: [],
      },
    },
  });
  renderWithClient(<App />);
  await review();
  fireEvent.change(screen.getByLabelText("Product notes"), {
    target: { value: "Delete this product" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send instruction" }));
  await waitFor(() => expect(submit("delete")).toBeEnabled());
  expect(writes().at(-1)?.body).toEqual({
    expectedRevision: 2,
    action: "delete",
  });
  expect(
    writes().filter((request) => request.path.endsWith("/submit")),
  ).toEqual([]);
});

it("keeps an unavailable in-person price explicit in the completed product summary", async () => {
  const result = mutationResult();
  if (!result.product) throw Error("Expected product fixture");
  result.product.inPersonPrice = null;
  override = (request) =>
    request.path.endsWith("/operation") ? Response.json(result) : undefined;
  renderWithClient(<App />);
  expect(
    await screen.findByRole("region", { name: "Product completion" }),
  ).toHaveTextContent("In-person price: Unavailable");
  expect(writes()).toEqual([]);
});
