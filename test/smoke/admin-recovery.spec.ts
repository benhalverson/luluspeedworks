/**
 * @file Exercises the production A2UI recovery flow against controlled HTTP outcomes.
 * Playwright owns each test's response map and request history outside the page,
 * so reload discards UI state while retaining the mocked operation evidence.
 * This isolates browser recovery behavior without running an API or proving
 * provider effects or database persistence.
 */
import { draft, draftId } from "../admin-fixtures";
import {
  mutationResult,
  operationId,
  preparation,
  preparationId,
} from "../admin-mutation-fixtures";
import { checkLayout, draftList, expect, test } from "./fixtures";

for (const action of ["create", "update", "delete"] as const) {
  test(`mocked ${action} acknowledgement loss recovers the same operation after reload`, async ({
    page,
    api,
  }) => {
    const saved = draft(
      action === "create"
        ? {}
        : {
            target: { kind: "existing", productId: 42 },
            context: { status: "unavailable", productId: 42 },
          },
    );
    const root = `/admin/product-drafts/${draftId}`;
    api.responses.set("GET /admin/product-drafts", { body: draftList(saved) });
    api.responses.set(`GET ${root}`, { body: saved });
    api.responses.set(`GET ${root}/preparation`, {
      body: { preparation: null },
    });
    const prepared = preparation(action);
    api.responses.set(`POST ${root}/pricing/prepare`, {
      body: { preparation: prepared },
    });
    let submitted = 0;
    const completed = mutationResult(
      action,
      action === "delete"
        ? { product: null, readiness: null, storefrontVisible: false }
        : {},
    );
    await page.route(`https://api.lulu.test${root}/submit`, async (route) => {
      submitted++;
      expect(route.request().postDataJSON()).toEqual({
        expectedRevision: 1,
        preparationId,
        action,
      });
      // Simulate a committed server operation whose acknowledgement is lost.
      // No route.fetch, backend server, database or provider is involved.
      api.responses.set(`GET ${root}/operation`, { body: completed });
      api.responses.set(`GET ${root}/preparation`, {
        body: { preparation: prepared },
      });
      api.expectedNetworkErrors.set(
        route.request().url(),
        "Failed to load resource: net::ERR_FAILED",
      );
      await route.abort("failed");
    });
    await page.goto("/admin/products");
    await page.getByRole("button", { name: "Edit draft facts" }).click();
    await page
      .getByRole("button", {
        name:
          action === "delete"
            ? "Review product deletion"
            : /^Review product( changes)?$/,
      })
      .click();
    const submit = page.getByRole("button", {
      name:
        action === "create"
          ? "Create product"
          : action === "delete"
            ? "Delete product"
            : "Save changes",
      exact: true,
    });
    await expect(submit).toBeEnabled();
    expect(submitted).toBe(0);
    if (action !== "delete") {
      await expect(
        page.getByText(/Online price: \$15\.00/).first(),
      ).toBeVisible();
      await expect(
        page.getByText(/In-person price: \$12\.00/).first(),
      ).toBeVisible();
    }
    await submit.click();
    await expect(
      page.getByRole("region", { name: "Product completion" }),
    ).toContainText(
      action === "create"
        ? "Product created."
        : action === "delete"
          ? "Product deleted."
          : "Product updated.",
    );
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Product completion" }),
    ).toContainText(
      action === "create"
        ? "Product created."
        : action === "delete"
          ? "Product deleted."
          : "Product updated.",
    );
    expect(submitted).toBe(1);
    expect(
      api.requests.filter((value) => value.endsWith("/reconcile")),
    ).toEqual([]);
    await checkLayout(page);
  });
}

for (const action of ["create", "update", "delete"] as const) {
  /**
   * Resume an already failed operation to check that viewing it cannot retry it.
   * The saved response supplies failure authority; backend error classification
   * is covered separately by the companion endpoint tests.
   */
  test(`mocked ${action} retains a terminal Square rejection across reload without retry`, async ({
    page,
    api,
  }) => {
    const saved = draft(
      action === "create"
        ? {}
        : {
            target: { kind: "existing", productId: 42 },
            context: { status: "unavailable", productId: 42 },
          },
    );
    const root = `/admin/product-drafts/${draftId}`;
    const result = mutationResult(action);
    if (!result.operation) throw Error("Expected operation fixture");
    const failed = {
      ...result,
      operation: {
        ...result.operation,
        state: "failed",
        error: "Square rejected the catalog change",
        retryable: false,
      },
      product: null,
      readiness: null,
      storefrontVisible: false,
    };
    api.responses.set("GET /admin/product-drafts", { body: draftList(saved) });
    api.responses.set(`GET ${root}`, { body: saved });
    api.responses.set(`GET ${root}/preparation`, {
      body: { preparation: preparation(action) },
    });
    api.responses.set(`GET ${root}/operation`, { body: failed });
    await page.goto("/admin/products");
    for (let visit = 0; visit < 2; visit++) {
      await expect(
        page.getByText(/Square rejected the catalog change/),
      ).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Product completion" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Check product operation" }),
      ).toHaveCount(0);
      expect(
        api.requests.filter((request) => !request.startsWith("GET ")),
      ).toEqual([]);
      await checkLayout(page);
      if (visit === 0) await page.reload();
    }
  });

  test(`mocked ${action} resumes repeated partial outcomes without resubmission`, async ({
    page,
    api,
  }) => {
    const saved = draft(
      action === "create"
        ? {}
        : {
            target: { kind: "existing", productId: 42 },
            context: { status: "unavailable", productId: 42 },
          },
    );
    const root = `/admin/product-drafts/${draftId}`;
    const prepared = preparation(action);
    const completed = mutationResult(
      action,
      action === "delete"
        ? { product: null, readiness: null, storefrontVisible: false }
        : {},
    );
    if (!completed.operation) throw Error("Expected operation fixture");
    /**
     * Script only the public operation states that an explicit check can advance.
     * Repeating repair_required verifies that another retry need not mean success;
     * deletion skips photo synchronization because it does not publish an image.
     */
    const stages = (
      [
        ["pending", "Square synchronization is pending."],
        [
          "item_confirmed",
          "Square item confirmed. Photo synchronization is pending.",
        ],
        [
          "square_confirmed",
          "Square confirmed. Local catalog save is pending.",
        ],
        ["repair_required", "The saved operation needs repair."],
        ["repair_required", "The saved operation needs repair."],
      ] as const
    ).filter(([state]) => action !== "delete" || state !== "item_confirmed");
    const outcomes = stages.map(([state]) => ({
      ...completed,
      operation: { ...completed.operation, state, retryable: true },
      // These are synthetic HTTP outcomes, not evidence of provider or DB effects.
      product: null,
      readiness: null,
      storefrontVisible: false,
    }));
    api.responses.set("GET /admin/product-drafts", { body: draftList(saved) });
    api.responses.set(`GET ${root}`, { body: saved });
    api.responses.set(`GET ${root}/preparation`, {
      body: { preparation: prepared },
    });
    /**
     * These per-test ledgers outlive page reload and capture the real UI's POST bodies.
     * The handlers also replace the operation GET response, so a fresh page reads
     * the latest mocked operation state. Only reconciliation advances the script;
     * a reload must neither create a new submission nor advance that sequence.
     */
    const submissions: unknown[] = [];
    const reconciliations: unknown[] = [];
    await page.route(`https://api.lulu.test${root}/submit`, async (route) => {
      submissions.push(route.request().postDataJSON());
      api.responses.set(`GET ${root}/operation`, { body: outcomes[0] });
      await route.fulfill({ json: outcomes[0] });
    });
    await page.route(
      `https://api.lulu.test${root}/reconcile`,
      async (route) => {
        reconciliations.push(route.request().postDataJSON());
        const outcome = outcomes[reconciliations.length] ?? completed;
        api.responses.set(`GET ${root}/operation`, { body: outcome });
        await route.fulfill({ json: outcome });
      },
    );
    await page.goto("/admin/products");
    const submit = page.getByRole("button", {
      name:
        action === "create"
          ? "Create product"
          : action === "delete"
            ? "Delete product"
            : "Save changes",
      exact: true,
    });
    await expect(submit).toBeEnabled();
    expect(submissions).toEqual([]);
    await submit.click();
    const status = page.getByRole("status", { name: "Draft status" });
    const completion = page.getByRole("region", { name: "Product completion" });
    const check = page.getByRole("button", { name: "Check product operation" });
    for (const [index, [, notice]] of stages.entries()) {
      await expect(status).toContainText(notice);
      await expect(completion).toHaveCount(0);
      await expect(submit).toBeDisabled();
      expect(reconciliations).toEqual(
        Array.from({ length: index }, () => ({ operationId })),
      );
      // A fresh visit consumes saved HTTP evidence without continuing a write.
      await page.reload();
      await expect(check).toBeEnabled();
      await expect(completion).toHaveCount(0);
      await expect(submit).toBeDisabled();
      expect(reconciliations).toHaveLength(index);
      await check.click();
      if (index < stages.length - 1) await expect(check).toBeEnabled();
    }
    await expect(completion).toContainText(
      action === "create"
        ? "Product created."
        : action === "delete"
          ? "Product deleted."
          : "Product updated.",
    );
    expect(submissions).toEqual([
      { expectedRevision: 1, preparationId, action },
    ]);
    expect(reconciliations).toEqual(
      Array.from({ length: stages.length }, () => ({ operationId })),
    );
    await page.reload();
    await expect(completion).toBeVisible();
    expect(submissions).toHaveLength(1);
    expect(reconciliations).toHaveLength(stages.length);
    await checkLayout(page);
  });
}
