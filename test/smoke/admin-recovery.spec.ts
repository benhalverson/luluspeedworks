import { draft, draftId } from "../admin-fixtures";
import {
  mutationResult,
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
            : "Update product",
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
      page.getByRole("region", { name: "Product Card" }),
    ).toContainText(
      action === "create"
        ? "Product created."
        : action === "delete"
          ? "Product deleted."
          : "Product updated.",
    );
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Product Card" }),
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
