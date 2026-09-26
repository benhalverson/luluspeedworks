import { draft, draftId } from "../admin-fixtures";
import { checkLayout, deferred, draftList, expect, test } from "./fixtures";

for (const status of [401, 403]) {
  for (const operation of ["detail", "save"]) {
    test(`${operation} ${status} hides all private workspace UI until fresh verification`, async ({
      page,
      api,
    }) => {
      await page.goto("/admin/products");
      await expect(
        page.getByRole("button", { name: "Edit draft facts" }),
      ).toBeVisible();
      await checkLayout(page);
      expect(
        api.requests.filter((key) => key === "GET /admin/product-drafts"),
      ).toHaveLength(1);
      await page.getByRole("button", { name: "Products", exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "Conversations", exact: true }),
      ).toBeFocused();
      expect(
        await page.evaluate(
          () =>
            document.activeElement?.matches(":focus-visible") &&
            parseFloat(getComputedStyle(document.activeElement).outlineWidth) >
              0,
        ),
      ).toBe(true);
      await page.getByRole("button", { name: "Edit draft facts" }).click();
      await page
        .getByLabel("Product name", { exact: true })
        .fill("Private edits");
      const oldVerification = deferred<{ body: unknown }>();
      if (operation === "detail") {
        api.responses.set("GET /admin/product-drafts", oldVerification.promise);
        api.responses.set(`GET /admin/product-drafts/${draftId}`, {
          status,
          body: {},
        });
        await page.evaluate(() =>
          window.dispatchEvent(new Event("visibilitychange")),
        );
      } else {
        api.responses.set(`PUT /admin/product-drafts/${draftId}`, {
          status,
          body: {},
        });
        await page.getByRole("button", { name: "Save draft answers" }).click();
      }
      await expect(page.getByRole("alert")).toContainText(
        status === 401
          ? "Your session has expired"
          : "Administrator access is required",
      );
      oldVerification.resolve({ body: draftList() });
      await expect(page.getByRole("navigation")).toHaveCount(0);
      await expect(page.getByRole("complementary")).toHaveCount(0);
      await expect(page.getByText("Private smoke conversation")).toHaveCount(0);
      await expect(
        page.getByLabel("Product name", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "+ New product", exact: true }),
      ).toHaveCount(0);
      api.responses.set("GET /admin/product-drafts", { status: 503, body: {} });
      await page.evaluate(() =>
        window.dispatchEvent(new Event("visibilitychange")),
      );
      await expect(page.getByRole("alert")).toHaveText(
        "Private conversations unavailable. Please retry.",
      );
      await expect(page.getByRole("navigation")).toHaveCount(0);
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "Retry conversations" }),
      ).toBeFocused();
      api.responses.clear();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("button", { name: "Edit draft facts" }),
      ).toBeVisible();
      await expect(page.getByText("Private smoke conversation")).toBeVisible();
      await checkLayout(page);
    });
  }
}

test("a delayed save cannot reopen the workspace after denial", async ({
  page,
  api,
}) => {
  await page.goto("/admin/products");
  await page.getByRole("button", { name: "Edit draft facts" }).click();
  await page
    .getByLabel("Product name", { exact: true })
    .fill("Delayed private save");
  const save = deferred<{ body: unknown }>();
  api.responses.set(`PUT /admin/product-drafts/${draftId}`, save.promise);
  await page.getByRole("button", { name: "Save draft answers" }).click();
  await expect
    .poll(() => api.requests.includes(`PUT /admin/product-drafts/${draftId}`))
    .toBe(true);
  api.responses.set("GET /admin/product-drafts", { status: 403, body: {} });
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByRole("alert")).toContainText(
    "Administrator access is required",
  );
  const response = page.waitForResponse(
    (response) => response.request().method() === "PUT",
  );
  save.resolve({
    body: draft({
      state: {
        answers: { name: "Delayed private save" },
        history: [],
        pendingQuestions: [],
      },
    }),
  });
  await response;
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText(
    "Administrator access is required",
  );
});

test("storefront account and bag remain dialogs and share admin branding", async ({
  page,
  api,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Account", exact: true }),
  ).toBeVisible();
  await checkLayout(page);
  const brand = await page
    .getByRole("link", { name: "Lulu Speedworks home" })
    .innerHTML();
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Your account" }),
  ).toBeVisible();
  await expect(
    page.getByRole("form", { name: "Shipping profile" }),
  ).toBeVisible();
  await expect(page.getByLabel("First name")).toHaveValue("Smoke");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Bag (0)" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Your bag" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Both bag triggers are valid return targets for the shared dialog.
  await expect(page.locator(":focus")).toHaveAttribute(
    "aria-haspopup",
    "dialog",
  );
  await expect(page.locator(":focus")).toBeVisible();
  await page.goto("/admin/products");
  await page.getByRole("button", { name: "Edit draft facts" }).waitFor();
  expect(
    await page.getByRole("link", { name: "Lulu Speedworks home" }).innerHTML(),
  ).toBe(brand);
  expect(api.requests).toContain("GET /profile");
  await checkLayout(page);
});
